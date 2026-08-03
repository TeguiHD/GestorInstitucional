import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateStudentDto } from './create-student.dto.js';

const base = {
  schoolId: '11111111-1111-4111-8111-111111111111',
  courseId: '22222222-2222-4222-8222-222222222222',
  firstName: 'Joaquin Augusto',
  lastName: 'Cheuquepal',
};

/** Reproduce el pipeline de NestJS: plainToInstance (aplica @Transform) → validate. */
async function validarRut(rut: string) {
  const dto = plainToInstance(CreateStudentDto, { ...base, rut });
  const errores = await validate(dto);
  return { ok: errores.length === 0, rutNormalizado: dto.rut, errores };
}

describe('CreateStudentDto — identificador del alumno', () => {
  it('acepta el IPE escrito de corrido, como lo pega el usuario desde la planilla', async () => {
    const r = await validarRut('1004483525');
    expect(r.ok).toBe(true);
    expect(r.rutNormalizado).toBe('100448352-5');
  });

  it('acepta IPE de 9 dígitos con guion', async () => {
    const r = await validarRut('100648936-9');
    expect(r.ok).toBe(true);
  });

  it('acepta RUT chileno con puntos y guion', async () => {
    const r = await validarRut('12.345.678-5');
    expect(r.ok).toBe(true);
    expect(r.rutNormalizado).toBe('12345678-5');
  });

  it('acepta RUT chileno escrito de corrido', async () => {
    const r = await validarRut('123456785');
    expect(r.ok).toBe(true);
    expect(r.rutNormalizado).toBe('12345678-5');
  });

  it('acepta K minúscula como dígito verificador', async () => {
    const r = await validarRut('100686027k');
    expect(r.ok).toBe(true);
    expect(r.rutNormalizado).toBe('100686027-K');
  });

  it('rechaza identificadores demasiado largos', async () => {
    const r = await validarRut('12345678901-2');
    expect(r.ok).toBe(false);
  });

  it('rechaza texto que no es un identificador', async () => {
    const r = await validarRut('no-es-un-rut');
    expect(r.ok).toBe(false);
  });
});
