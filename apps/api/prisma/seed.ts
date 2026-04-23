import { PrismaClient, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('Admin1234!567', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Seed school
  const school = await prisma.school.upsert({
    where: { slug: 'cssp' },
    update: {},
    create: {
      name: 'Colegio San Sebastián de Paine',
      slug: 'cssp',
      address: 'Paine, Región Metropolitana, Chile',
    },
  });

  // Seed super admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@cssp.cl' },
    update: {},
    create: {
      email: 'admin@cssp.cl',
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      schoolRoles: {
        create: [{ schoolId: school.id, role: SystemRole.SUPER_ADMIN }],
      },
    },
  });

  // Seed test director
  await prisma.user.upsert({
    where: { email: 'director@cssp.cl' },
    update: {},
    create: {
      email: 'director@cssp.cl',
      passwordHash,
      firstName: 'María',
      lastName: 'González',
      schoolRoles: { create: [{ schoolId: school.id, role: SystemRole.DIRECTOR }] },
    },
  });

  // Seed test teacher
  await prisma.user.upsert({
    where: { email: 'profesor@cssp.cl' },
    update: {},
    create: {
      email: 'profesor@cssp.cl',
      passwordHash,
      firstName: 'Carlos',
      lastName: 'Rodríguez',
      schoolRoles: { create: [{ schoolId: school.id, role: SystemRole.PROFESOR }] },
    },
  });

  // Seed 1°A–8°A 2026
  const COURSES = [
    { code: '1A', name: '1° Básico A' },
    { code: '2A', name: '2° Básico A' },
    { code: '3A', name: '3° Básico A' },
    { code: '4A', name: '4° Básico A' },
    { code: '5A', name: '5° Básico A' },
    { code: '6A', name: '6° Básico A' },
    { code: '7A', name: '7° Básico A' },
    { code: '8A', name: '8° Básico A' },
  ];

  const courses = await Promise.all(
    COURSES.map((c) =>
      prisma.course.upsert({
        where: { schoolId_code_year: { schoolId: school.id, code: c.code, year: 2026 } },
        update: {},
        create: { schoolId: school.id, code: c.code, name: c.name, level: 'Básica', year: 2026 },
      }),
    ),
  );

  console.log('✓ Seeded:', {
    school: school.slug,
    adminId: admin.id,
    courses: courses.map((c) => c.code),
  });
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect());
