import { AlertTrigger, AttendanceStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchoolConfigService } from '../school-config/school-config.service.js';
import { AlertsService } from './alerts.service.js';

function d(day: number) {
  return new Date(2026, 2, day, 12);
}

function schoolConfig() {
  return new SchoolConfigService({} as never, { log: vi.fn() } as never);
}

describe('AlertsService attendance thresholds', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marca en riesgo cuando un día sin registro baja la asistencia bajo el umbral', async () => {
    vi.setSystemTime(new Date(2026, 2, 6, 12));

    const student = {
      id: 'student-1',
      firstName: 'Alumno',
      lastName: 'Prueba',
      rut: '11111111-1',
      enrolledAt: d(2),
      withdrawnAt: null,
    };
    const prisma = {
      school: { findUnique: vi.fn().mockResolvedValue({ id: 'school-1', name: 'Colegio' }) },
      alertRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rule-1',
            trigger: AlertTrigger.STUDENT_BELOW_THRESHOLD,
            threshold: 0.7,
            windowDays: 5,
            notifyRoles: JSON.stringify(['DIRECTOR']),
          },
        ]),
      },
      student: { findMany: vi.fn().mockResolvedValue([student]) },
      attendanceRecord: {
        findMany: vi.fn().mockResolvedValue([
          { studentId: student.id, date: d(2), status: AttendanceStatus.PRESENT },
          { studentId: student.id, date: d(3), status: AttendanceStatus.LATE },
          { studentId: student.id, date: d(4), status: AttendanceStatus.JUSTIFIED },
          { studentId: student.id, date: d(5), status: AttendanceStatus.ABSENT },
        ]),
      },
      alertFired: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'fired-1' }),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const mail = { sendSystemAlert: vi.fn() };
    const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
    const service = new AlertsService(
      prisma as never,
      mail as never,
      calendar as never,
      schoolConfig(),
    );

    await expect(service.triggerManual('school-1')).resolves.toEqual({ checked: 1, fired: 1 });
    expect(prisma.alertFired.create).toHaveBeenCalledWith({
      data: { ruleId: 'rule-1', entityType: 'school', entityId: 'school-1', meta: { count: 1 } },
    });
  });
});
