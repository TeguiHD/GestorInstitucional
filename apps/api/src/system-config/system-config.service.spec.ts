import { mkdtemp, rm, writeFile } from 'fs/promises';
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
      }),
    );

    const config = await service.getBackupConfig();
    const download = await service.getLatestBackupDownload();

    expect(config.latestDownloadAvailable).toBe(true);
    expect(config.latestDownloadFileName).toBe('backup_asistencia_test.sql.zip');
    expect(config.latestDownloadFileSizeBytes).toBe(3);
    expect(download.filePath).toBe(filePath);
    expect(download.size).toBe(3);

    await rm(backupDir, { recursive: true, force: true });
  });

  it('bloquea descarga si la ruta sale del directorio de backups', async () => {
    const backupDir = await mkdtemp(path.join(tmpdir(), 'asistencia-backups-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'outside-backups-'));
    process.env.BACKUP_DIR = backupDir;
    const filePath = path.join(outsideDir, 'backup_asistencia_test.sql.zip');
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
        backup_download_expires_at: '2999-01-01 00:00:00',
      }),
    );

    await expect(service.getLatestBackupDownload()).rejects.toBeInstanceOf(ForbiddenException);

    await rm(backupDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });
});
