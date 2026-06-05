import { AttendanceStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchoolConfigService } from '../school-config/school-config.service.js';
import { WeeklyDigestCron } from './weekly-digest.cron.js';

function d(day: number) {
  return new Date(2026, 2, day, 12);
}

function schoolConfig() {
  return new SchoolConfigService({} as never, { log: vi.fn() } as never);
}

describe('WeeklyDigestCron attendance formulas', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('usa P + AT sobre total clases e incluye el día sin registro', async () => {
    vi.setSystemTime(new Date(2026, 2, 6, 12));

    const weeklyDigest = vi.fn().mockReturnValue({
      subject: 'Resumen semanal',
      html: '<p>ok</p>',
      text: 'ok',
    });
    const mail = {
      enabled: true,
      templates: { weeklyDigest },
      enqueue: vi.fn().mockResolvedValue({ id: 'mail-1' }),
      webUrl: vi.fn().mockReturnValue('https://app.test'),
    };
    const student = {
      id: 'student-1',
      firstName: 'Alumno',
      lastName: 'Prueba',
      enrolledAt: d(2),
      withdrawnAt: null,
      course: { name: 'Primero A' },
    };
    const prisma = {
      school: { findMany: vi.fn().mockResolvedValue([{ id: 'school-1', name: 'Colegio' }]) },
      guardianship: {
        findMany: vi.fn().mockResolvedValue([
          {
            guardian: {
              email: 'apoderado@test.cl',
              firstName: 'Apo',
              lastName: 'Derado',
            },
            student,
          },
        ]),
      },
      attendanceRecord: {
        findMany: vi.fn().mockResolvedValue([
          { date: d(2), status: AttendanceStatus.PRESENT },
          { date: d(3), status: AttendanceStatus.LATE },
          { date: d(4), status: AttendanceStatus.JUSTIFIED },
          { date: d(5), status: AttendanceStatus.ABSENT },
        ]),
      },
    };
    const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
    const cron = new WeeklyDigestCron(
      prisma as never,
      mail as never,
      calendar as never,
      schoolConfig(),
    );

    await cron.run();

    expect(weeklyDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({
          present: 1,
          late: 1,
          justified: 1,
          absent: 1,
          missing: 1,
          total: 5,
          rate: 0.4,
        }),
      }),
    );
    expect(mail.enqueue).toHaveBeenCalledTimes(1);
  });
});
