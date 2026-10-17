import { describe, expect, it } from 'vitest';

import { BACKUP_RETENTION, planBackupRetention } from './backup-retention.js';

/** Nombre real de un respaldo diario (02:00 UTC = 23:00 de Chile del día anterior). */
function name(date: string, time = '020000'): string {
  return `backup_asistencia_${date}_${time}.zip`;
}

/** Un respaldo diario por cada día entre `from` y `to` (inclusive), en UTC. */
function dailyBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); ) {
    out.push(name(d.toISOString().slice(0, 10)));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

const NOW = new Date('2026-10-17T19:00:00Z');

describe('planBackupRetention', () => {
  it('no borra nada si hay pocos respaldos', () => {
    const files = dailyBetween('2026-10-01', '2026-10-14');
    expect(planBackupRetention(files, { now: NOW }).remove).toEqual([]);
  });

  it('conserva todo lo de los últimos 14 días, aunque haya varios por día', () => {
    const files = [
      ...dailyBetween('2026-01-01', '2026-10-17'),
      name('2026-10-16', '153000'), // "Generar y descargar ahora" manual
    ];
    const plan = planBackupRetention(files, { now: NOW });
    const recent = files.filter((f) => f >= name('2026-10-04', '000000'));
    for (const f of recent) expect(plan.remove).not.toContain(f);
    expect(plan.keep.get(name('2026-10-16', '153000'))).toBe('daily');
  });

  it('más allá de 14 días guarda uno por semana (8), uno por mes (24) y uno por año', () => {
    const files = dailyBetween('2022-03-01', '2026-10-17');
    const plan = planBackupRetention(files, { now: NOW });
    const tiers = [...plan.keep.values()];

    expect(tiers.filter((t) => t === 'daily')).toHaveLength(BACKUP_RETENTION.dailyDays);
    expect(tiers.filter((t) => t === 'weekly').length).toBeLessThanOrEqual(BACKUP_RETENTION.weeks);
    // El último de cada mes cerrado se conserva (p. ej. 31-ago-2026 y 30-abr-2025).
    expect(plan.keep.has(name('2026-08-31'))).toBe(true);
    expect(plan.keep.has(name('2025-04-30'))).toBe(true);
    // Los 24 meses son nov-2024..oct-2026; antes de eso, solo el último de cada año.
    expect(plan.keep.get(name('2024-12-31'))).toBe('monthly');
    expect(plan.remove).toContain(name('2024-10-31'));
    expect(plan.keep.get(name('2023-12-31'))).toBe('yearly');
    expect(plan.keep.get(name('2022-12-31'))).toBe('yearly');
    expect(plan.remove).toContain(name('2023-06-15'));
    // Acotado: ~14 diarios + 8 semanales + 24 mensuales + años, no 1.690 archivos.
    expect(plan.keep.size).toBeLessThan(55);
    expect(plan.keep.size + plan.remove.length).toBe(files.length);
  });

  it('nunca toca archivos con nombre desconocido ni los protegidos (enlaces de descarga vigentes)', () => {
    const files = [
      ...dailyBetween('2025-01-01', '2026-10-17'),
      'pre_restore_20250101_120000.sql',
      'backup_asistencia_manual.zip',
    ];
    const protectedName = name('2025-02-11');
    const plan = planBackupRetention(files, { now: NOW, protect: new Set([protectedName]) });

    expect(plan.remove).not.toContain('pre_restore_20250101_120000.sql');
    expect(plan.remove).not.toContain('backup_asistencia_manual.zip');
    expect(plan.remove).not.toContain(protectedName);
    expect(plan.keep.get(protectedName)).toBe('protected');
  });

  it('siempre conserva el respaldo más nuevo aunque el reloj esté atrasado', () => {
    const files = dailyBetween('2025-01-01', '2026-10-17');
    const plan = planBackupRetention(files, { now: new Date('2024-01-01T00:00:00Z') });
    expect(plan.remove).not.toContain(name('2026-10-17'));
  });
});
