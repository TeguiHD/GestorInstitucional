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

describe('AlertsService.upsertRule — validación de threshold por tipo', () => {
  function makeService() {
    const prisma = { alertRule: { upsert: vi.fn().mockResolvedValue({ id: 'rule-1' }) } };
    const service = new AlertsService(
      prisma as never,
      { sendSystemAlert: vi.fn() } as never,
      { getNonSchoolDays: vi.fn() } as never,
      schoolConfig(),
    );
    return { service, prisma };
  }

  it('rechaza umbral de días guardado como fracción (bug histórico del form: 3 → 0.03)', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.upsertRule({
        schoolId: 'school-1',
        trigger: AlertTrigger.STUDENT_CONSECUTIVE_ABSENCES,
        threshold: 0.03,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.alertRule.upsert).not.toHaveBeenCalled();
  });

  it('acepta fracción para porcentajes y entero para días', async () => {
    const { service } = makeService();
    await expect(
      service.upsertRule({
        schoolId: 'school-1',
        trigger: AlertTrigger.STUDENT_BELOW_THRESHOLD,
        threshold: 0.85,
      }),
    ).resolves.toBeTruthy();
    await expect(
      service.upsertRule({
        schoolId: 'school-1',
        trigger: AlertTrigger.TEACHER_NO_RECORD,
        threshold: 2,
      }),
    ).resolves.toBeTruthy();
  });
});

describe('AlertsService.runDailyAlerts — días no lectivos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeService(opts: { nonSchoolDays: string[] }) {
    const prisma = {
      school: {
        findMany: vi.fn().mockResolvedValue([{ id: 'school-1', name: 'Colegio' }]),
      },
      alertRule: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const mail = { sendSystemAlert: vi.fn() };
    const calendar = {
      getNonSchoolDays: vi.fn().mockResolvedValue(new Set(opts.nonSchoolDays)),
    };
    const service = new AlertsService(
      prisma as never,
      mail as never,
      calendar as never,
      schoolConfig(),
    );
    return { service, prisma };
  }

  it('salta la evaluación cuando hoy es día no lectivo (vacaciones/feriado)', async () => {
    vi.setSystemTime(new Date(2026, 5, 24, 12)); // 24-jun-2026: vacaciones de invierno

    const { service, prisma } = makeService({ nonSchoolDays: ['2026-06-24'] });
    await service.runDailyAlerts();

    expect(prisma.alertRule.findMany).not.toHaveBeenCalled();
  });

  it('evalúa normalmente en un día lectivo', async () => {
    vi.setSystemTime(new Date(2026, 6, 7, 12)); // 7-jul-2026: 2º semestre en curso

    const { service, prisma } = makeService({ nonSchoolDays: [] });
    await service.runDailyAlerts();

    expect(prisma.alertRule.findMany).toHaveBeenCalled();
  });
});

describe('AlertsService TEACHER_NO_RECORD — cuenta días lectivos, no corridos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const WINTER_BREAK = [
    '2026-06-19',
    '2026-06-22',
    '2026-06-23',
    '2026-06-24',
    '2026-06-25',
    '2026-06-26',
    '2026-06-29',
    '2026-06-30',
    '2026-07-01',
    '2026-07-02',
    '2026-07-03',
  ];

  function makeService(opts: { latestByTeacher: Record<string, Date | null> }) {
    const teachers = Object.keys(opts.latestByTeacher);
    const prisma = {
      school: { findUnique: vi.fn().mockResolvedValue({ id: 'school-1', name: 'Colegio' }) },
      alertRule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'rule-1',
            trigger: AlertTrigger.TEACHER_NO_RECORD,
            threshold: 2,
            windowDays: 30,
            notifyRoles: JSON.stringify(['DIRECTOR']),
          },
        ]),
      },
      courseTeacher: {
        findMany: vi.fn().mockResolvedValue(
          teachers.map((teacherId, idx) => ({
            course: { id: `course-${idx}`, code: `C${idx}` },
            user: { id: teacherId, firstName: 'Profe', lastName: teacherId },
          })),
        ),
      },
      attendanceRecord: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          const latest = opts.latestByTeacher[where.recordedById as string];
          return Promise.resolve(latest ? { date: latest } : null);
        }),
      },
      alertFired: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'fired-1' }),
      },
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ email: 'directora@cssp.cl', firstName: 'Dir', lastName: 'A' }]),
      },
    };
    const mail = { sendSystemAlert: vi.fn().mockResolvedValue(undefined) };
    const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set(WINTER_BREAK)) };
    const service = new AlertsService(
      prisma as never,
      mail as never,
      calendar as never,
      schoolConfig(),
    );
    return { service, prisma, mail };
  }

  it('no alerta al volver de vacaciones si el profesor registró el último día lectivo', async () => {
    // Hoy: martes 7-jul-2026. Últimos 2 días lectivos: 6-jul y 18-jun.
    vi.setSystemTime(new Date(2026, 6, 7, 12));

    const { service, prisma } = makeService({
      latestByTeacher: { t1: new Date('2026-06-18T00:00:00.000Z') },
    });

    await expect(service.triggerManual('school-1')).resolves.toEqual({ checked: 1, fired: 0 });
    expect(prisma.alertFired.create).not.toHaveBeenCalled();
  });

  it('sí alerta al profesor que ya estaba atrasado antes de las vacaciones', async () => {
    vi.setSystemTime(new Date(2026, 6, 7, 12));

    const { service, mail } = makeService({
      latestByTeacher: {
        t1: new Date('2026-06-18T00:00:00.000Z'),
        t2: new Date('2026-06-16T00:00:00.000Z'),
      },
    });

    await expect(service.triggerManual('school-1')).resolves.toEqual({ checked: 1, fired: 1 });
    const body = (mail.sendSystemAlert.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain('Profe t2');
    expect(body).not.toContain('Profe t1');
  });
});
