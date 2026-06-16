import { describe, expect, it } from 'vitest';

import {
  attendanceDraftStorageKey,
  buildPresentStatusMap,
  deserializeAttendanceDirty,
  getDateCompletion,
  getNextAttendanceStatus,
  isStudentActiveOnDate,
  serializeAttendanceDirty,
} from './monthly-attendance-grid.logic';

const students = [
  { id: 's1', enrolledAt: '2026-05-01T00:00:00.000Z', withdrawnAt: null },
  { id: 's2', enrolledAt: '2026-05-10T00:00:00.000Z', withdrawnAt: null },
  { id: 's3', enrolledAt: '2026-05-01T00:00:00.000Z', withdrawnAt: '2026-05-15T00:00:00.000Z' },
];

describe('monthly attendance grid logic', () => {
  it('calcula alumnos activos por dia de matricula', () => {
    expect(isStudentActiveOnDate(students[0]!, '2026-05-09')).toBe(true);
    expect(isStudentActiveOnDate(students[1]!, '2026-05-09')).toBe(false);
    expect(isStudentActiveOnDate(students[2]!, '2026-05-14')).toBe(true);
    expect(isStudentActiveOnDate(students[2]!, '2026-05-15')).toBe(false);
  });

  it('construye todos presentes excluyendo alumnos fuera de fecha', () => {
    const map = buildPresentStatusMap(students, '2026-05-09', {});

    expect(Object.fromEntries(map)).toEqual({ s1: 'PRESENT', s3: 'PRESENT' });
  });

  it('detecta un dia parcial y celdas faltantes', () => {
    const completion = getDateCompletion(students, '2026-05-12', {
      s1: { '2026-05-12': 'PRESENT' },
    });

    expect(completion.isPartial).toBe(true);
    expect(completion.missingStudentIds).toEqual(['s2', 's3']);
  });

  it('considera dirty al validar completitud antes de guardar', () => {
    const dirty = new Map([
      [
        '2026-05-12',
        new Map([
          ['s2', 'ABSENT' as const],
          ['s3', 'PRESENT' as const],
        ]),
      ],
    ]);

    const completion = getDateCompletion(
      students,
      '2026-05-12',
      { s1: { '2026-05-12': 'PRESENT' } },
      dirty,
    );

    expect(completion.isComplete).toBe(true);
  });

  it('mantiene el ciclo de estados esperado', () => {
    expect(getNextAttendanceStatus(undefined)).toBe('PRESENT');
    expect(getNextAttendanceStatus('PRESENT')).toBe('ABSENT');
    expect(getNextAttendanceStatus('ABSENT')).toBe('LATE');
    expect(getNextAttendanceStatus('LATE')).toBe('JUSTIFIED');
    expect(getNextAttendanceStatus('JUSTIFIED')).toBe('PRESENT');
  });

  it('serializa y restaura un borrador mensual', () => {
    const dirty = new Map([
      [
        '2026-05-12',
        new Map([
          ['s1', 'PRESENT' as const],
          ['s2', 'ABSENT' as const],
        ]),
      ],
    ]);

    const serialized = serializeAttendanceDirty(dirty);
    const restored = deserializeAttendanceDirty(serialized);

    expect(serialized).toEqual({ '2026-05-12': { s1: 'PRESENT', s2: 'ABSENT' } });
    expect(Object.fromEntries(restored.get('2026-05-12') ?? [])).toEqual({
      s1: 'PRESENT',
      s2: 'ABSENT',
    });
  });

  it('descarta celdas invalidas al restaurar borrador', () => {
    const restored = deserializeAttendanceDirty(
      {
        '2026-05-09': {
          s1: 'PRESENT',
          s2: 'ABSENT',
          s3: 'LATE',
          unknown: 'PRESENT',
        },
        '2026-05-12': {
          s1: 'NOPE',
        },
        '2026-05-20': {
          s1: 'PRESENT',
        },
      },
      {
        students,
        dates: ['2026-05-09', '2026-05-12', '2026-05-20'],
        matrix: {},
        nonSchoolDays: { '2026-05-20': { type: 'HOLIDAY' } },
        today: '2026-05-15',
      },
    );

    expect(Object.fromEntries(restored.get('2026-05-09') ?? [])).toEqual({
      s1: 'PRESENT',
      s3: 'LATE',
    });
    expect(restored.has('2026-05-12')).toBe(false);
    expect(restored.has('2026-05-20')).toBe(false);
  });

  it('usa una clave estable de borrador por curso y mes', () => {
    expect(attendanceDraftStorageKey('user-1', 'course-1', 2026, 5)).toBe(
      'cssp:attendance-draft:user-1:course-1:2026-05',
    );
  });
});
