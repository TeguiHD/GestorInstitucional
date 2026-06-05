import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getBackupConfig() {
    const keys = ['backup_emails', 'backup_time', 'backup_password', 'backup_active'];
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });

    const configMap = new Map(settings.map((s) => [s.key, s.value]));

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

    return {
      emails,
      time,
      hasPassword,
      active,
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

  async testBackup() {
    const scriptPath = path.resolve(process.cwd(), 'infra/backup/run-backup.sh');
    exec(`bash ${scriptPath} force`, (error, stdout, _stderr) => {
      if (error) {
        console.error(`[Backup Manual Test Error]: ${error.message}`);
        return;
      }
      console.log(`[Backup Manual Test Success]: ${stdout}`);
    });
    return { success: true, message: 'Prueba de backup iniciada en segundo plano.' };
  }
}
