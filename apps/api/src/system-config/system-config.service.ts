import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'child_process';
import { createHash, timingSafeEqual } from 'crypto';
import { stat } from 'fs/promises';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';

const BACKUP_KEYS = [
  'backup_emails',
  'backup_time',
  'backup_password',
  'backup_active',
  'backup_last_success_at',
  'backup_last_attempt_at',
  'backup_last_status',
  'backup_last_error',
  'backup_last_message_id',
  'backup_last_delivery_mode',
  'backup_last_file_name',
  'backup_last_file_size_bytes',
  'backup_last_download_expires_at',
  'backup_download_token_hash',
  'backup_download_path',
  'backup_download_file_name',
  'backup_download_file_size_bytes',
  'backup_download_expires_at',
];

const BACKUP_TZ = 'America/Santiago';
const RUNNING_TTL_MS = 2 * 60 * 60 * 1000;

type BackupStatus = 'idle' | 'running' | 'success' | 'failed';
type BackupDeliveryMode = 'attachment' | 'download_link';
type BackupConfigResponse = {
  emails: string;
  time: string;
  hasPassword: boolean;
  active: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: BackupStatus;
  lastError: string | null;
  running: boolean;
  lastMessageId: string | null;
  lastDeliveryMode: BackupDeliveryMode | null;
  lastFileName: string | null;
  lastFileSizeBytes: number | null;
  lastDownloadExpiresAt: string | null;
  latestDownloadAvailable: boolean;
  latestDownloadFileName: string | null;
  latestDownloadFileSizeBytes: number | null;
  latestDownloadExpiresAt: string | null;
};

type BackupFileDownload = {
  filePath: string;
  fileName: string;
  size: number;
  expiresAt: string;
};

@Injectable()
export class SystemConfigService {
  private readonly log = new Logger(SystemConfigService.name);
  private inProcessBackupRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  async getBackupConfig(): Promise<BackupConfigResponse> {
    const configMap = await this.getBackupSettings();

    // Fallbacks from environment if not set in DB
    const emails = configMap.has('backup_emails')
      ? configMap.get('backup_emails')!
      : process.env.BACKUP_EMAILS || '';

    const time = configMap.has('backup_time')
      ? configMap.get('backup_time')!
      : process.env.BACKUP_TIME_HHMM || '23:00';

    const active = configMap.has('backup_active')
      ? configMap.get('backup_active') === 'true'
      : true;

    const hasPassword = !!configMap.get('backup_password');
    const lastStatus = (configMap.get('backup_last_status') || 'idle') as BackupStatus;
    const lastDeliveryModeRaw = configMap.get('backup_last_delivery_mode') || '';
    const lastDeliveryMode =
      lastDeliveryModeRaw === 'attachment' || lastDeliveryModeRaw === 'download_link'
        ? lastDeliveryModeRaw
        : null;
    const lastFileSizeRaw = configMap.get('backup_last_file_size_bytes') || '';
    const lastFileSizeBytes = lastFileSizeRaw ? Number(lastFileSizeRaw) : null;

    const lastMessageId = configMap.get('backup_last_message_id') || null;
    const latestDownload = await this.resolveStoredBackupFile(configMap).catch(() => null);
    const latestDownloadAvailable =
      lastStatus === 'success' && !!lastMessageId && latestDownload != null;

    return {
      emails,
      time,
      hasPassword,
      active,
      lastSuccessAt: configMap.get('backup_last_success_at') || null,
      lastAttemptAt: configMap.get('backup_last_attempt_at') || null,
      lastStatus,
      lastError: configMap.get('backup_last_error') || null,
      running: this.isBackupRunning(configMap),
      lastMessageId,
      lastDeliveryMode,
      lastFileName: configMap.get('backup_last_file_name') || null,
      lastFileSizeBytes: Number.isFinite(lastFileSizeBytes) ? lastFileSizeBytes : null,
      lastDownloadExpiresAt: configMap.get('backup_last_download_expires_at') || null,
      latestDownloadAvailable,
      latestDownloadFileName: latestDownload?.fileName ?? null,
      latestDownloadFileSizeBytes: latestDownload?.size ?? null,
      latestDownloadExpiresAt: latestDownload?.expiresAt ?? null,
    };
  }

  async updateBackupConfig(data: {
    emails: string;
    time: string;
    encryptPassword?: string;
    active: boolean;
  }) {
    const updates = [
      { key: 'backup_emails', value: data.emails },
      { key: 'backup_time', value: data.time },
      { key: 'backup_active', value: data.active ? 'true' : 'false' },
    ];

    if (data.encryptPassword && data.encryptPassword.trim() !== '') {
      updates.push({ key: 'backup_password', value: data.encryptPassword });
    }

    await this.prisma.$transaction(
      updates.map((up) =>
        this.prisma.systemSetting.upsert({
          where: { key: up.key },
          update: { value: up.value },
          create: { key: up.key, value: up.value },
        }),
      ),
    );

    return this.getBackupConfig();
  }

  @Cron('* * * * *', { name: 'backup-daily-runner', timeZone: BACKUP_TZ })
  async runScheduledBackupIfDue() {
    const configMap = await this.getBackupSettings();
    const config = await this.getBackupConfig();
    if (!this.shouldRunScheduledBackup(configMap, config)) return;

    try {
      await this.startBackup('scheduled');
    } catch (error) {
      if (error instanceof ConflictException) return;
      this.log.warn(`Scheduled backup could not start: ${(error as Error).message}`);
    }
  }

  async testBackup() {
    return this.startBackup('manual');
  }

  async getBackupDownload(token: string | undefined) {
    if (!token) throw new NotFoundException('Respaldo no encontrado');
    const configMap = await this.getBackupSettings();
    const tokenHash = configMap.get('backup_download_token_hash');
    const filePath = configMap.get('backup_download_path');
    const expiresAt = this.parseUtcSql(configMap.get('backup_download_expires_at'));

    if (!tokenHash || !filePath || !expiresAt) {
      throw new NotFoundException('Respaldo no encontrado');
    }
    if (expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('El enlace de respaldo expiró');
    }

    const providedHash = createHash('sha256').update(token).digest('hex');
    const expected = Buffer.from(tokenHash, 'hex');
    const provided = Buffer.from(providedHash, 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new NotFoundException('Respaldo no encontrado');
    }

    return this.resolveStoredBackupFile(configMap);
  }

  async getLatestBackupDownload() {
    const configMap = await this.getBackupSettings();
    if (configMap.get('backup_last_status') !== 'success') {
      throw new NotFoundException('No hay respaldo exitoso para descargar');
    }
    if (!configMap.get('backup_last_message_id')) {
      throw new NotFoundException('El último respaldo no tiene confirmación de correo');
    }
    return this.resolveStoredBackupFile(configMap);
  }

  private async startBackup(source: 'manual' | 'scheduled') {
    const configMap = await this.getBackupSettings();
    if (this.isBackupRunning(configMap)) {
      throw new ConflictException('Ya hay un backup en ejecución');
    }

    const scriptPath = path.resolve(process.cwd(), 'infra/backup/run-backup.sh');
    const startedAt = this.utcSqlNow();
    await this.upsertSettings({
      backup_last_attempt_at: startedAt,
      backup_last_status: 'running',
      backup_last_error: '',
      backup_last_message_id: '',
      backup_last_delivery_mode: '',
      backup_last_file_name: '',
      backup_last_file_size_bytes: '',
      backup_last_download_expires_at: '',
    });

    this.inProcessBackupRunning = true;
    const child = spawn('bash', [scriptPath, 'force'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BACKUP_TRIGGER: source,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('error', (error) => {
      this.inProcessBackupRunning = false;
      void this.upsertSettings({
        backup_last_status: 'failed',
        backup_last_error: error.message.slice(0, 1000),
      });
      this.log.error(`Backup ${source} failed to spawn: ${error.message}`);
    });

    child.on('close', (code) => {
      this.inProcessBackupRunning = false;
      const status: BackupStatus = code === 0 ? 'success' : 'failed';
      void this.upsertSettings({
        backup_last_status: status,
        backup_last_error: code === 0 ? '' : output.slice(-1000),
      });
      if (code === 0) {
        this.log.log(`Backup ${source} completed`);
      } else {
        this.log.warn(`Backup ${source} failed with exit code ${code}: ${output.slice(-500)}`);
      }
    });

    return {
      success: true,
      status: 'running' as const,
      source,
      startedAt,
      message: 'Backup iniciado. Revisa el estado en este panel.',
    };
  }

  private async getBackupSettings(): Promise<Map<string, string>> {
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: BACKUP_KEYS } },
    });
    return new Map(settings.map((s) => [s.key, s.value]));
  }

  private async upsertSettings(values: Record<string, string>) {
    await this.prisma.$transaction(
      Object.entries(values).map(([key, value]) =>
        this.prisma.systemSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );
  }

  private async resolveStoredBackupFile(
    configMap: Map<string, string>,
  ): Promise<BackupFileDownload> {
    const filePath = configMap.get('backup_download_path');
    const fileName = configMap.get('backup_download_file_name') || 'backup_asistencia.sql.zip';
    const expiresAtRaw = configMap.get('backup_download_expires_at');
    const expiresAt = this.parseUtcSql(expiresAtRaw);

    if (!filePath || !expiresAt || !expiresAtRaw) {
      throw new NotFoundException('Respaldo no encontrado');
    }
    if (expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('El enlace de respaldo expiró');
    }

    const backupRoot = path.resolve(
      process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups'),
    );
    const safePath = path.resolve(filePath);
    if (!safePath.startsWith(`${backupRoot}${path.sep}`) && safePath !== backupRoot) {
      throw new ForbiddenException('Ruta de respaldo inválida');
    }

    const info = await stat(safePath).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('Archivo de respaldo no encontrado');

    return {
      filePath: safePath,
      fileName,
      size: info.size,
      expiresAt: expiresAtRaw,
    };
  }

  private isBackupRunning(configMap: Map<string, string>): boolean {
    if (this.inProcessBackupRunning) return true;
    if (configMap.get('backup_last_status') !== 'running') return false;

    const attemptAt = this.parseUtcSql(configMap.get('backup_last_attempt_at'));
    if (!attemptAt) return false;
    return Date.now() - attemptAt.getTime() < RUNNING_TTL_MS;
  }

  private shouldRunScheduledBackup(
    configMap: Map<string, string>,
    config: BackupConfigResponse,
  ): boolean {
    if (!config.active || this.isBackupRunning(configMap)) return false;
    if (!config.emails.trim()) return false;

    const now = new Date();
    const nowLocal = this.localDateParts(now);
    const scheduled = this.minutesFromHHMM(config.time);
    if (nowLocal.minutesOfDay < scheduled) return false;

    const lastSuccess = this.parseUtcSql(config.lastSuccessAt);
    if (!lastSuccess) return true;

    const lastLocal = this.localDateParts(lastSuccess);
    return !(lastLocal.date === nowLocal.date && lastLocal.minutesOfDay >= scheduled);
  }

  private minutesFromHHMM(value: string): number {
    const [hourRaw, minuteRaw] = value.split(':');
    return Number(hourRaw ?? 0) * 60 + Number(minuteRaw ?? 0);
  }

  private localDateParts(date: Date): { date: string; minutesOfDay: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BACKUP_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      minutesOfDay: hour * 60 + minute,
    };
  }

  private utcSqlNow(): string {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  private parseUtcSql(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(`${value.replace(' ', 'T')}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
