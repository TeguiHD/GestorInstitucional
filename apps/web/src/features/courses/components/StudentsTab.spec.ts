import { describe, expect, it } from 'vitest';

import { attendanceFractionLabel } from './StudentsTab';

describe('StudentsTab attendance text', () => {
  it('muestra presentes sobre total clases sin sumar atrasos resueltos ni justificados', () => {
    expect(
      attendanceFractionLabel({
        present: 1,
        totalClasses: 5,
      }),
    ).toBe('1/5 clases');
  });

  it('descuenta los atrasos pendientes del total de clases', () => {
    expect(
      attendanceFractionLabel({
        present: 3,
        pendingLate: 1,
        totalClasses: 5,
      }),
    ).toBe('3/4 clases');
  });
});
