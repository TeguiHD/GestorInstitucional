import { mkdtemp, rm, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';

import { ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SystemConfigService } from './system-config.service.js';

function makeService() {
  const prisma = {
    systemSetting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return new SystemConfigService(prisma as never);
}

function settings(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

function config(
  overrides: Partial<Awaited<ReturnType<SystemConfigService['getBackupConfig']>>> = {},
) {
  return {
    emails: 'admin@colegio.cl',
    time: '23:00',
    hasPassword: false,
    passwordCompatible: true,
    active: true,
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastStatus: 'idle' as const,
    lastError: null,
    running: false,
    ...overrides,
  };
}

describe('SystemConfigService backup scheduler', () => {
  afterEach(() => {
    delete process.env.BACKUP_DIR;
    vi.useRealTimers();
  });

  it('ejecuta el respaldo diario cuando ya paso la hora configurada', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T03:10:00.000Z')); // 23:10 America/Santiago
    const service = makeService();

    const shouldRun = (
      service as unknown as {
        shouldRunScheduledBackup: (
          settings: Map<string, string>,
          cfg: ReturnType<typeof config>,
        ) => boolean;
      }
    ).shouldRunScheduledBackup(new Map(), config());

    expect(shouldRun).toBe(true);
  });

  it('no ejecuta antes de la hora configurada', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T02:50:00.000Z')); // 22:50 America/Santiago
    const service = makeService();

    const shouldRun = (
      service as unknown as {
        shouldRunScheduledBackup: (
          settings: Map<string, string>,
          cfg: ReturnType<typeof config>,
        ) => boolean;
      }
    ).shouldRunScheduledBackup(new Map(), config());

    expect(shouldRun).toBe(false);
  });

  it('no duplica si ya hubo respaldo exitoso en la ventana diaria', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T03:20:00.000Z')); // 23:20 America/Santiago
    const service = makeService();

    const shouldRun = (
      service as unknown as {
        shouldRunScheduledBackup: (
          settings: Map<string, string>,
          cfg: ReturnType<typeof config>,
        ) => boolean;
      }
    ).shouldRunScheduledBackup(new Map(), config({ lastSuccessAt: '2026-06-17 03:05:00' }));

    expect(shouldRun).toBe(false);
  });

  it('expone y descarga el ultimo ZIP confirmado por Brevo', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const filePath = path.join(backupDir, 'backup_asistencia_test.sql.zip');
    await writeFile(filePath, 'zip');

    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({
        backup_last_status: 'success',
        backup_last_message_id: 'message-id',
        backup_download_path: filePath,
        backup_download_file_name: 'backup_asistencia_test.sql.zip',
        backup_download_file_size_bytes: '3',
        backup_download_expires_at: '2999-01-01 00:00:00',
        backup_last_download_verified_at: '2026-06-17 03:00:00',
        backup_last_download_verified_status: '200',
      }),
    );

    const config = await service.getBackupConfig();
    const download = await service.getLatestBackupDownload();

    expect(config.latestDownloadAvailable).toBe(true);
    expect(config.latestDownloadFileName).toBe('backup_asistencia_test.sql.zip');
    expect(config.latestDownloadFileSizeBytes).toBe(3);
    expect(config.lastDownloadVerifiedAt).toBe('2026-06-17 03:00:00');
    expect(config.lastDownloadVerifiedStatus).toBe('200');
    expect(download.filePath).toBe(filePath);
    expect(download.size).toBe(3);

    await rm(backupDir, { recursive: true, force: true });
  });

  it('marca como incompatible una contrasena con caracteres fuera de ASCII', async () => {
    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({
        backup_password: 'clave-con-ñ',
      }),
    );

    const config = await service.getBackupConfig();

    expect(config.hasPassword).toBe(true);
    expect(config.passwordCompatible).toBe(false);
  });

  it('mantiene descargable el ultimo respaldo confirmado aunque el ultimo intento falle', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const filePath = path.join(backupDir, 'backup_asistencia_confirmado.sql.zip');
    await writeFile(filePath, 'zip');

    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({
        backup_last_status: 'failed',
        backup_last_error: 'fallo posterior',
        backup_last_message_id: 'message-id-confirmado',
        backup_download_path: filePath,
        backup_download_file_name: 'backup_asistencia_confirmado.sql.zip',
        backup_download_expires_at: '2999-01-01 00:00:00',
      }),
    );

    const config = await service.getBackupConfig();
    const download = await service.getLatestBackupDownload();

    expect(config.lastStatus).toBe('failed');
    expect(config.latestDownloadAvailable).toBe(true);
    expect(download.fileName).toBe('backup_asistencia_confirmado.sql.zip');

    await rm(backupDir, { recursive: true, force: true });
  });

  it('nunca sirve una ruta fuera del directorio de backups (path traversal)', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'outside-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const outsidePath = path.join(outsideDir, 'backup_asistencia_test.sql.zip');
    await writeFile(outsidePath, 'malicioso');
    // Archivo legítimo dentro del root.
    const insidePath = path.join(backupDir, 'backup_asistencia_2026-06-17_230000.zip');
    await writeFile(insidePath, 'ok');

    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({
        backup_last_status: 'success',
        backup_last_message_id: 'message-id',
        backup_download_path: outsidePath,
        backup_download_file_name: 'backup_asistencia_test.sql.zip',
        backup_download_expires_at: '2999-01-01 00:00:00',
      }),
    );

    // La ruta maliciosa se ignora; se sirve el archivo seguro dentro del root.
    const download = await service.getLatestBackupDownload();
    expect(download.filePath).toBe(insidePath);
    expect(download.filePath.startsWith(backupDir)).toBe(true);

    await rm(backupDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('genera una contrasena ASCII fuerte y zip-safe', () => {
    const service = makeService();
    const gen = (
      service as unknown as { generateAsciiBackupPassword: (len?: number) => string }
    ).generateAsciiBackupPassword.bind(service);
    for (let i = 0; i < 50; i++) {
      const pw = gen(24);
      expect(pw).toHaveLength(24);
      // ASCII imprimible y sin caracteres que rompan shell/zip ("$`\\ y comillas)
      expect(/^[A-Za-z0-9._=+\-!?@#%]+$/.test(pw)).toBe(true);
    }
  });

  it('repara la contrasena no-ASCII generando una compatible antes del backup', async () => {
    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: {
          systemSetting: { findMany: ReturnType<typeof vi.fn> };
          $transaction: ReturnType<typeof vi.fn>;
        };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(settings({ backup_password: 'clave-con-ñ' }));
    prisma.$transaction.mockResolvedValue([]);

    const healed = await (
      service as unknown as { ensureUsableBackupPassword: () => Promise<string> }
    ).ensureUsableBackupPassword();

    expect(healed).not.toContain('ñ');
    expect(/^[\x20-\x7e]+$/.test(healed)).toBe(true);
    // persiste la nueva contrasena
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('conserva una contrasena ASCII existente sin regenerarla', async () => {
    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: {
          systemSetting: { findMany: ReturnType<typeof vi.fn> };
          $transaction: ReturnType<typeof vi.fn>;
        };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({ backup_password: 'MiClaveASCII123' }),
    );

    const healed = await (
      service as unknown as { ensureUsableBackupPassword: () => Promise<string> }
    ).ensureUsableBackupPassword();

    expect(healed).toBe('MiClaveASCII123');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('expone la contrasena en passwordPlain para mostrarla en el panel', async () => {
    const service = makeService();
    const prisma = (
      service as unknown as { prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } } }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({ backup_password: 'MiClaveASCII123' }),
    );

    const cfg = await service.getBackupConfig();
    expect(cfg.passwordPlain).toBe('MiClaveASCII123');
  });

  it('mantiene la descarga disponible aunque no haya messageId de correo', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const filePath = path.join(backupDir, 'backup_asistencia_sinmsg.zip');
    await writeFile(filePath, 'zip');

    const service = makeService();
    const prisma = (
      service as unknown as { prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } } }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({
        backup_download_path: filePath,
        backup_download_file_name: 'backup_asistencia_sinmsg.zip',
        backup_download_expires_at: '2999-01-01 00:00:00',
      }),
    );

    const cfg = await service.getBackupConfig();
    expect(cfg.latestDownloadAvailable).toBe(true);
    const download = await service.getLatestBackupDownload();
    expect(download.fileName).toBe('backup_asistencia_sinmsg.zip');

    await rm(backupDir, { recursive: true, force: true });
  });

  it('lista el historial de respaldos ordenado del mas nuevo al mas viejo', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    process.env.BACKUP_DIR = backupDir;
    await writeFile(path.join(backupDir, 'backup_asistencia_2026-06-16_220000.zip'), 'a');
    await writeFile(path.join(backupDir, 'backup_asistencia_2026-06-17_230000.zip'), 'bb');
    await writeFile(path.join(backupDir, 'ignorar.txt'), 'x');

    const service = makeService();
    const history = await service.listBackupHistory();

    expect(history.map((h) => h.fileName)).toEqual([
      'backup_asistencia_2026-06-17_230000.zip',
      'backup_asistencia_2026-06-16_220000.zip',
    ]);
    expect(history[0]!.sizeBytes).toBe(2);

    await rm(backupDir, { recursive: true, force: true });
  });

  it('bloquea descarga por nombre con path traversal', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const service = makeService();

    await expect(service.getBackupFileByName('../../etc/passwd')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await rm(backupDir, { recursive: true, force: true });
  });

  it('permite descargar con un token historico vigente', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const filePath = path.join(backupDir, 'backup_historico.sql.7z');
    await writeFile(filePath, '7z');
    const token = 'token-historico';
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const service = makeService();
    const prisma = (
      service as unknown as {
        prisma: { systemSetting: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma;
    prisma.systemSetting.findMany.mockResolvedValue(
      settings({
        backup_download_token_hash: createHash('sha256').update('token-actual').digest('hex'),
        backup_download_path: path.join(backupDir, 'backup_actual.sql.7z'),
        backup_download_file_name: 'backup_actual.sql.7z',
        backup_download_expires_at: '2999-01-01 00:00:00',
        backup_download_tokens: JSON.stringify([
          {
            tokenHash,
            path: filePath,
            fileName: 'backup_historico.sql.7z',
            sizeBytes: 2,
            expiresAt: '2999-01-01 00:00:00',
          },
        ]),
      }),
    );

    const download = await service.getBackupDownload(token);

    expect(download.filePath).toBe(filePath);
    expect(download.fileName).toBe('backup_historico.sql.7z');
    expect(download.size).toBe(2);

    await rm(backupDir, { recursive: true, force: true });
  });
});
