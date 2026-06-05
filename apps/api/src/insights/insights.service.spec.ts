import { AttendanceStatus } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchoolConfigService } from '../school-config/school-config.service.js';
import { InsightsService } from './insights.service.js';

function d(day: number) {
  return new Date(2026, 2, day, 12);
}

function schoolConfig() {
  return new SchoolConfigService({} as never, { log: vi.fn() } as never);
}

describe('InsightsService attendance formulas', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calcula insights de curso como P + AT sobre días lectivos activos', async () => {
    vi.setSystemTime(new Date(2026, 2, 6, 12));

    const student = {
      id: 'student-1',
      firstName: 'Alumno',
      lastName: 'Prueba',
      enrolledAt: d(2),
      withdrawnAt: null,
    };
    const prisma = {
      course: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'course-1',
          code: '1A',
          name: 'Primero A',
          schoolId: 'school-1',
        }),
      },
      student: {
        findMany: vi.fn().mockResolvedValue([student]),
      },
      attendanceRecord: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { studentId: student.id, date: d(2), status: AttendanceStatus.PRESENT, student },
            { studentId: student.id, date: d(3), status: AttendanceStatus.LATE, student },
            { studentId: student.id, date: d(4), status: AttendanceStatus.JUSTIFIED, student },
            { studentId: student.id, date: d(5), status: AttendanceStatus.ABSENT, student },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      },
    };
    const calendar = { getNonSchoolDays: vi.fn().mockResolvedValue(new Set<string>()) };
    const service = new InsightsService(prisma as never, calendar as never, schoolConfig());

    const result = await service.getCourseInsights('course-1', 2026, 3);

    expect(result.attendanceRate).toBe(0.4);
    const risk = result.insights.find((insight) => insight.type === 'risk_students');
    expect(risk?.meta?.students).toEqual([
      expect.objectContaining({
        id: student.id,
        rate: 0.4,
        totalClasses: 5,
        missing: 1,
      }),
    ]);
  });
});
