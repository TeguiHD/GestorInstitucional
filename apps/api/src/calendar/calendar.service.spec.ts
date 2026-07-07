import { describe, expect, it, vi } from 'vitest';

import { parseDateOnlyUtc } from '../common/date-only.js';
import { SchoolConfigService } from '../school-config/school-config.service.js';
import { CalendarService } from './calendar.service.js';

type CalendarRow = { date: Date; type: string; description: string };

type SavedConfig = {
  firstSemesterStart: Date;
  firstSemesterEnd: Date;
  secondSemesterStart: Date;
  secondSemesterEnd: Date;
};

/**
 * Construye un CalendarService con un SchoolConfigService REAL (prisma mockeado)
 * para ejercer la matemática de semestres de verdad, no un stub.
 */
function makeService(opts?: {
  calendarRows?: CalendarRow[];
  /** Config guardada para 2026; si se omite se usan los defaults del servicio. */
  savedConfig?: SavedConfig | null;
}) {
  const rows = (opts?.calendarRows ?? []).map((row, idx) => ({
    id: `day-${idx}`,
    schoolId: 'school-1',
    createdAt: new Date(),
    ...row,
  }));

  const prisma = {
    school: {
      findUnique: vi.fn().mockResolvedValue({ id: 'school-1' }),
    },
    schoolAcademicYearConfig: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (!opts?.savedConfig) return Promise.resolve(null);
        if (where.schoolId_year.year !== 2026) return Promise.resolve(null);
        return Promise.resolve({
          id: 'cfg-1',
          schoolId: 'school-1',
          year: 2026,
          ...opts.savedConfig,
        });
      }),
    },
    schoolCalendarDay: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        const from: Date | undefined = where?.date?.gte;
        const to: Date | undefined = where?.date?.lte;
        const types: string[] | undefined = where?.type?.in;
        return Promise.resolve(
          rows.filter(
            (row) =>
              (!from || row.date >= from) &&
              (!to || row.date <= to) &&
              (!types || types.includes(row.type)),
          ),
        );
      }),
    },
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const mail = { sendSuspensionBroadcast: vi.fn() };
  const schoolConfig = new SchoolConfigService(prisma as never, audit as never);

  return {
    service: new CalendarService(prisma as never, mail as never, schoolConfig),
    prisma,
  };
}

const d = parseDateOnlyUtc;

describe('CalendarService.getNonSchoolDays — período lectivo', () => {
  it('marca como no lectivos los días entre semestres (vacaciones de invierno, config default)', async () => {
    const { service } = makeService();

    const set = await service.getNonSchoolDays('school-1', d('2026-06-15'), d('2026-07-07'));

    // Brecha entre 1er semestre (termina 18-jun) y 2º semestre default (parte 1-jul)
    expect(set.has('2026-06-19')).toBe(true);
    expect(set.has('2026-06-22')).toBe(true);
    expect(set.has('2026-06-30')).toBe(true);
    // Días dentro de semestre siguen siendo lectivos
    expect(set.has('2026-06-17')).toBe(false);
    expect(set.has('2026-06-18')).toBe(false);
    expect(set.has('2026-07-01')).toBe(false); // default: 2º semestre parte 1-jul
    expect(set.has('2026-07-06')).toBe(false);
  });

  it('respeta la configuración guardada del colegio (2º semestre desde el 6 de julio)', async () => {
    const { service } = makeService({
      savedConfig: {
        firstSemesterStart: d('2026-03-04'),
        firstSemesterEnd: d('2026-06-18'),
        secondSemesterStart: d('2026-07-06'),
        secondSemesterEnd: d('2026-12-18'),
      },
    });

    const set = await service.getNonSchoolDays('school-1', d('2026-06-15'), d('2026-07-07'));

    expect(set.has('2026-06-19')).toBe(true);
    expect(set.has('2026-07-01')).toBe(true);
    expect(set.has('2026-07-02')).toBe(true);
    expect(set.has('2026-07-03')).toBe(true);
    expect(set.has('2026-07-06')).toBe(false);
    expect(set.has('2026-07-07')).toBe(false);
    expect(set.has('2026-06-18')).toBe(false);
  });

  it('mantiene los feriados del calendario dentro del semestre', async () => {
    const { service } = makeService({
      calendarRows: [{ date: d('2026-07-16'), type: 'HOLIDAY', description: 'Virgen del Carmen' }],
      savedConfig: {
        firstSemesterStart: d('2026-03-04'),
        firstSemesterEnd: d('2026-06-18'),
        secondSemesterStart: d('2026-07-06'),
        secondSemesterEnd: d('2026-12-18'),
      },
    });

    const set = await service.getNonSchoolDays('school-1', d('2026-07-06'), d('2026-07-31'));

    expect(set.has('2026-07-16')).toBe(true);
    expect(set.has('2026-07-15')).toBe(false);
  });

  it('marca el verano como no lectivo (antes del 1er semestre y después del 2º)', async () => {
    const { service } = makeService({
      savedConfig: {
        firstSemesterStart: d('2026-03-04'),
        firstSemesterEnd: d('2026-06-18'),
        secondSemesterStart: d('2026-07-06'),
        secondSemesterEnd: d('2026-12-18'),
      },
    });

    const before = await service.getNonSchoolDays('school-1', d('2026-02-23'), d('2026-03-06'));
    expect(before.has('2026-03-02')).toBe(true);
    expect(before.has('2026-03-03')).toBe(true);
    expect(before.has('2026-03-04')).toBe(false);
    expect(before.has('2026-03-05')).toBe(false);

    const after = await service.getNonSchoolDays('school-1', d('2026-12-14'), d('2026-12-28'));
    expect(after.has('2026-12-17')).toBe(false);
    expect(after.has('2026-12-18')).toBe(false);
    expect(after.has('2026-12-21')).toBe(true);
    expect(after.has('2026-12-22')).toBe(true);
  });

  it('rechaza rangos absurdamente amplios (protección de queries por día)', async () => {
    const { service } = makeService();

    await expect(
      service.getNonSchoolDays('school-1', d('2020-01-01'), d('2030-01-01')),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('cruza el año hacia el verano siguiente usando la config de cada año', async () => {
    const { service } = makeService({
      savedConfig: {
        firstSemesterStart: d('2026-03-04'),
        firstSemesterEnd: d('2026-06-18'),
        secondSemesterStart: d('2026-07-06'),
        secondSemesterEnd: d('2026-12-18'),
      },
    });

    // 2027 no tiene config guardada → defaults 2027 (1er semestre parte 4-mar-2027)
    const set = await service.getNonSchoolDays('school-1', d('2026-12-28'), d('2027-01-05'));
    expect(set.has('2026-12-28')).toBe(true);
    expect(set.has('2027-01-04')).toBe(true);
    expect(set.has('2027-01-05')).toBe(true);
  });
});

describe('CalendarService.getNonSchoolDayDetails — período lectivo', () => {
  it('etiqueta la brecha entre semestres como vacaciones de invierno', async () => {
    const { service } = makeService();

    const details = await service.getNonSchoolDayDetails(
      'school-1',
      d('2026-06-15'),
      d('2026-07-07'),
    );

    expect(details['2026-06-22']).toEqual({
      type: 'VACATION',
      description: 'Vacaciones de invierno',
    });
    expect(details['2026-06-18']).toBeUndefined();
  });

  it('etiqueta el verano como vacaciones de verano', async () => {
    const { service } = makeService();

    const details = await service.getNonSchoolDayDetails(
      'school-1',
      d('2026-02-23'),
      d('2026-03-06'),
    );

    expect(details['2026-03-02']).toEqual({
      type: 'VACATION',
      description: 'Vacaciones de verano',
    });
  });

  it('un feriado registrado en la BD gana sobre la etiqueta sintética de vacaciones', async () => {
    const { service } = makeService({
      calendarRows: [
        { date: d('2026-06-29'), type: 'HOLIDAY', description: 'San Pedro y San Pablo' },
      ],
    });

    const details = await service.getNonSchoolDayDetails(
      'school-1',
      d('2026-06-15'),
      d('2026-07-07'),
    );

    expect(details['2026-06-29']).toEqual({
      type: 'HOLIDAY',
      description: 'San Pedro y San Pablo',
    });
    // El resto de la brecha sigue etiquetada como vacaciones
    expect(details['2026-06-30']).toEqual({
      type: 'VACATION',
      description: 'Vacaciones de invierno',
    });
  });
});
