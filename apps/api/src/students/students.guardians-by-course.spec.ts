import { SystemRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { StudentsService } from './students.service.js';

import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

const director: JwtPayload = {
  sub: 'user-1',
  roles: [SystemRole.DIRECTOR],
  schoolId: 'school-1',
} as JwtPayload;

function guardian(id: string, nombre: string) {
  return {
    id,
    email: `${id}@example.cl`,
    firstName: nombre,
    lastName: 'Apoderado',
    status: 'ACTIVE',
    lastLoginAt: null,
  };
}

/** Alumnos del curso, con sus vínculos ya incluidos por la query. */
function alumnosConApoderados() {
  return [
    {
      id: 'alumno-1',
      guardianships: [
        {
          guardianId: 'g-1',
          studentId: 'alumno-1',
          isPrimary: true,
          guardian: guardian('g-1', 'Ana'),
        },
        {
          guardianId: 'g-2',
          studentId: 'alumno-1',
          isPrimary: false,
          guardian: guardian('g-2', 'Beto'),
        },
      ],
    },
    {
      id: 'alumno-2',
      guardianships: [
        {
          guardianId: 'g-3',
          studentId: 'alumno-2',
          isPrimary: true,
          guardian: guardian('g-3', 'Carla'),
        },
      ],
    },
    // Alumno sin apoderados: debe aparecer igual, con lista vacía.
    { id: 'alumno-3', guardianships: [] },
  ];
}

function makeService(students = alumnosConApoderados()) {
  const prisma = {
    course: { findUnique: vi.fn().mockResolvedValue({ schoolId: 'school-1' }) },
    student: { findMany: vi.fn().mockResolvedValue(students) },
    courseTeacher: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const service = new StudentsService(
    prisma as never,
    { log: vi.fn() } as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

describe('listGuardiansByCourse — reemplaza el N+1 del panel de curso', () => {
  it('devuelve los apoderados de todo el curso en una sola consulta', async () => {
    const { service, prisma } = makeService();

    const result = await service.listGuardiansByCourse('curso-1', director);

    // La razón de existir de este endpoint: una consulta, no una por alumno.
    expect(prisma.student.findMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual(['alumno-1', 'alumno-2', 'alumno-3']);
    expect(result['alumno-1']).toHaveLength(2);
    expect(result['alumno-2']).toHaveLength(1);
  });

  it('incluye a los alumnos sin apoderados con lista vacía', async () => {
    const { service } = makeService();
    const result = await service.listGuardiansByCourse('curso-1', director);
    // El frontend indexa por id: si falta la clave, rompe al renderizar.
    expect(result['alumno-3']).toEqual([]);
  });

  it('mantiene la forma que ya consumía el frontend', async () => {
    const { service } = makeService();
    const result = await service.listGuardiansByCourse('curso-1', director);
    const primero = result['alumno-1']![0]!;
    expect(primero).toHaveProperty('guardian.firstName', 'Ana');
    expect(primero).toHaveProperty('isPrimary', true);
  });

  it('sólo pide los alumnos del curso solicitado', async () => {
    const { service, prisma } = makeService();
    await service.listGuardiansByCourse('curso-1', director);
    const args = prisma.student.findMany.mock.calls[0]![0] as { where: { courseId: string } };
    expect(args.where.courseId).toBe('curso-1');
  });

  it('rechaza a quien no tiene acceso al curso', async () => {
    const { service, prisma } = makeService();
    prisma.course.findUnique.mockResolvedValue({ schoolId: 'otro-colegio' });
    const profesorAjeno = {
      sub: 'user-9',
      roles: [SystemRole.PROFESOR],
      schoolId: 'otro-colegio',
    } as JwtPayload;

    await expect(service.listGuardiansByCourse('curso-1', profesorAjeno)).rejects.toThrow();
  });

  it('devuelve objeto vacío si el curso no tiene alumnos', async () => {
    const { service } = makeService([]);
    await expect(service.listGuardiansByCourse('curso-1', director)).resolves.toEqual({});
  });
});
