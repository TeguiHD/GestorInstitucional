import { describe, expect, it } from 'vitest';

import { attendanceFractionLabel } from './StudentsTab';

describe('StudentsTab attendance text', () => {
  it('muestra P + AT sobre total clases sin sumar justificados', () => {
    expect(
      attendanceFractionLabel({
        present: 1,
        late: 1,
        totalClasses: 5,
      }),
    ).toBe('2/5 clases');
  });
});
