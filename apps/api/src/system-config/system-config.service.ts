import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { spawn } from 'child_process';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { readdir, stat } from 'fs/promises';
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
  'backup_last_download_verified_at',
  'backup_last_download_verified_status',
  'backup_download_token_hash',
  'backup_download_path',
  'backup_download_file_name',
  'backup_download_file_size_bytes',
  'backup_download_expires_at',
  'backup_download_tokens',
];

const BACKUP_TZ = 'America/Santiago';
const RUNNING_TTL_MS = 2 * 60 * 60 * 1000;

type BackupStatus = 'idle' | 'running' | 'success' | 'failed';
type BackupDeliveryMode = 'attachment' | 'download_link';
type BackupConfigResponse = {
  emails: string;
  time: string;
  hasPassword: boolean;
  passwordCompatible: boolean;
  passwordPlain: string | null;
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
  lastDownloadVerifiedAt: string | null;
  lastDownloadVerifiedStatus: string | null;
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

type StoredBackupDownload = {
  tokenHash: string;
  path: string;
  fileName: string;
  sizeBytes?: number;
  expiresAt: string;
};

type BackupHistoryItem = {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  encrypted: boolean;
};

// ASCII imprimible y sin caracteres que rompan shell/zip ("$`\\ y comillas).
const BACKUP_PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._=+-!?@#%';

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
    const passwordCompatible = this.isZipPasswordCompatible(configMap.get('backup_password') || '');
    const lastStatus = (configMap.get('backup_last_status') || 'idle') as BackupStatus;
    const lastDeliveryModeRaw = configMap.get('backup_last_delivery_mode') || '';
    const lastDeliveryMode =
      lastDeliveryModeRaw === 'attachment' || lastDeliveryModeRaw === 'download_link'
        ? lastDeliveryModeRaw
        : null;
    const lastFileSizeRaw = configMap.get('backup_last_file_size_bytes') || '';
    const lastFileSizeBytes = lastFileSizeRaw ? Number(lastFileSizeRaw) : null;

    const lastMessageId = configMap.get('backup_last_message_id') || null;
    const latestDownload = await this.resolveLatestBackupFile(configMap).catch(() => null);
    const latestDownloadAvailable = latestDownload != null;

    return {
      emails,
      time,
      hasPassword,
      passwordCompatible,
      passwordPlain: configMap.get('backup_password') || null,
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
      lastDownloadVerifiedAt: configMap.get('backup_last_download_verified_at') || null,
      lastDownloadVerifiedStatus: configMap.get('backup_last_download_verified_status') || null,
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
      if (!this.isZipPasswordCompatible(data.encryptPassword)) {
        throw new BadRequestException(
          'La contraseña del backup debe usar solo caracteres ASCII imprimibles para generar ZIP cifrado.',
        );
      }
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
    const providedHash = createHash('sha256').update(token).digest('hex');

    const currentTokenHash = configMap.get('backup_download_token_hash');
    if (currentTokenHash && this.sameHash(currentTokenHash, providedHash)) {
      return this.resolveStoredBackupFile(configMap);
    }

    for (const download of this.parseStoredDownloadTokens(
      configMap.get('backup_download_tokens'),
    )) {
      if (!this.sameHash(download.tokenHash, providedHash)) continue;
      return this.resolveBackupFile({
        filePath: download.path,
        fileName: download.fileName,
        expiresAtRaw: download.expiresAt,
      });
    }

    throw new NotFoundException('Respaldo no encontrado');
  }

  async getLatestBackupDownload() {
    const configMap = await this.getBackupSettings();
    return this.resolveLatestBackupFile(configMap);
  }

  private async startBackup(source: 'manual' | 'scheduled') {
    const configMap = await this.getBackupSettings();
    if (this.isBackupRunning(configMap)) {
      throw new ConflictException('Ya hay un backup en ejecución');
    }
    // Auto-repara una contraseña ausente o no-ASCII para que el ZIP cifrado
    // nunca falle por compatibilidad. La nueva clave queda visible en el panel.
    await this.ensureUsableBackupPassword();

    const scriptPath = path.resolve(process.cwd(), 'infra/backup/run-backup.sh');
    const startedAt = this.utcSqlNow();
    await this.upsertSettings({
      backup_last_attempt_at: startedAt,
      backup_last_status: 'running',
      backup_last_error: '',
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
    return this.resolveBackupFile({
      filePath: configMap.get('backup_download_path'),
      fileName: configMap.get('backup_download_file_name') || 'backup_asistencia.sql.zip',
      expiresAtRaw: configMap.get('backup_download_expires_at'),
    });
  }

  private async resolveBackupFile(input: {
    filePath: string | null | undefined;
    fileName: string;
    expiresAtRaw: string | null | undefined;
  }): Promise<BackupFileDownload> {
    const { filePath, fileName, expiresAtRaw } = input;
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

  private backupRootDir(): string {
    return path.resolve(process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups'));
  }

  /** Genera una contraseña ASCII fuerte y segura para shell/zip. */
  private generateAsciiBackupPassword(length = 24): string {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += BACKUP_PASSWORD_ALPHABET[randomInt(BACKUP_PASSWORD_ALPHABET.length)];
    }
    return out;
  }

  /**
   * Garantiza que exista una contraseña de backup compatible con ZIP AES.
   * Si falta o tiene caracteres no-ASCII, genera una nueva y la persiste.
   * Devuelve la contraseña vigente.
   */
  private async ensureUsableBackupPassword(): Promise<string> {
    const configMap = await this.getBackupSettings();
    const current = configMap.get('backup_password') || '';
    if (current && this.isZipPasswordCompatible(current)) return current;

    const generated = this.generateAsciiBackupPassword(24);
    await this.upsertSettings({ backup_password: generated });
    this.log.warn(
      'Contraseña de backup ausente o incompatible con ZIP AES; se generó una nueva (visible en el panel).',
    );
    return generated;
  }

  /** Resuelve el último respaldo descargable; cae al archivo más nuevo en disco. */
  private async resolveLatestBackupFile(
    configMap: Map<string, string>,
  ): Promise<BackupFileDownload> {
    const stored = await this.resolveStoredBackupFile(configMap).catch(() => null);
    if (stored) return stored;
    return this.resolveNewestBackupFileOnDisk();
  }

  private async resolveNewestBackupFileOnDisk(): Promise<BackupFileDownload> {
    const history = await this.listBackupHistory();
    const newest = history[0];
    if (!newest) throw new NotFoundException('No hay respaldos disponibles');
    return this.statBackupFileWithinRoot(newest.fileName);
  }

  /** Valida que el nombre esté dentro del directorio de backups y retorna su info. */
  private async statBackupFileWithinRoot(fileName: string): Promise<BackupFileDownload> {
    const backupRoot = this.backupRootDir();
    const safePath = path.resolve(backupRoot, fileName);
    if (!safePath.startsWith(`${backupRoot}${path.sep}`)) {
      throw new ForbiddenException('Ruta de respaldo inválida');
    }
    const info = await stat(safePath).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('Archivo de respaldo no encontrado');
    return {
      filePath: safePath,
      fileName: path.basename(safePath),
      size: info.size,
      expiresAt: '',
    };
  }

  async listBackupHistory(): Promise<BackupHistoryItem[]> {
    const backupRoot = this.backupRootDir();
    const entries = await readdir(backupRoot, { withFileTypes: true }).catch(() => []);
    const items: BackupHistoryItem[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!name.startsWith('backup_asistencia')) continue;
      if (!/\.(zip|7z|sql)$/i.test(name)) continue;
      const info = await stat(path.resolve(backupRoot, name)).catch(() => null);
      if (!info?.isFile()) continue;
      items.push({
        fileName: name,
        sizeBytes: info.size,
        createdAt: info.mtime.toISOString(),
        encrypted: /\.(zip|7z)$/i.test(name),
      });
    }
    // Nombres con timestamp embebido ordenan cronológicamente; createdAt como respaldo.
    items.sort(
      (a, b) => b.fileName.localeCompare(a.fileName) || b.createdAt.localeCompare(a.createdAt),
    );
    return items;
  }

  /** Descarga de un respaldo del historial por nombre (sólo admin). */
  async getBackupFileByName(fileName: string): Promise<BackupFileDownload> {
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      throw new ForbiddenException('Nombre de respaldo inválido');
    }
    if (path.basename(fileName) !== fileName) {
      throw new ForbiddenException('Nombre de respaldo inválido');
    }
    return this.statBackupFileWithinRoot(fileName);
  }

  private parseStoredDownloadTokens(raw: string | null | undefined): StoredBackupDownload[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is StoredBackupDownload => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<StoredBackupDownload>;
        return (
          typeof candidate.tokenHash === 'string' &&
          typeof candidate.path === 'string' &&
          typeof candidate.fileName === 'string' &&
          typeof candidate.expiresAt === 'string'
        );
      });
    } catch {
      return [];
    }
  }

  private sameHash(expectedHash: string, providedHash: string): boolean {
    try {
      const expected = Buffer.from(expectedHash, 'hex');
      const provided = Buffer.from(providedHash, 'hex');
      return expected.length === provided.length && timingSafeEqual(expected, provided);
    } catch {
      return false;
    }
  }

  private isZipPasswordCompatible(password: string): boolean {
    if (!password) return true;
    for (const char of password) {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || code > 0x7e) return false;
    }
    return true;
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
