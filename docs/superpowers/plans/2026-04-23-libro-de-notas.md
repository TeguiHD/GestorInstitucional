# Libro de Notas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar un libro de notas chileno completo: asignaturas por curso, ingreso de notas por período (P1–P4, exámenes, nota final) con cálculo automático según ponderaciones MINEDUC, y vista de notas en el detalle del alumno.

**Architecture:** Dos nuevos modelos Prisma (`Subject` + `Grade`), dos módulos NestJS (`SubjectsModule`, `GradesModule`), y UI en `CourseDetailPage` (tab "Notas" con grilla alumno×período) y `StudentDetailPage` (tab "Notas" junto a asistencia). El modelo `Subject` también es base del plan de Horarios — si ambos se implementan, solo crear la migración una vez. Escala chilena: 1.0–7.0, aprobación 4.0, NF = promedio semestral ponderado (notas 60% + examen 40%).

**Tech Stack:** NestJS + Prisma + MariaDB (backend), React + TanStack Query + Tailwind (frontend), TypeScript con `exactOptionalPropertyTypes: true`.

---

## Critical Files

**Backend (create):**

- `apps/api/src/subjects/subjects.module.ts`
- `apps/api/src/subjects/subjects.controller.ts`
- `apps/api/src/subjects/subjects.service.ts`
- `apps/api/src/subjects/dto/create-subject.dto.ts`
- `apps/api/src/grades/grades.module.ts`
- `apps/api/src/grades/grades.controller.ts`
- `apps/api/src/grades/grades.service.ts`
- `apps/api/src/grades/dto/upsert-grades.dto.ts`

**Backend (modify):**

- `apps/api/prisma/schema.prisma` — añadir `Subject`, `Grade`, relaciones
- `apps/api/src/app.module.ts` — registrar `SubjectsModule`, `GradesModule`

**Frontend (create):**

- `apps/web/src/features/courses/components/GradesTab.tsx`
- `apps/web/src/features/courses/components/SubjectsManager.tsx`

**Frontend (modify):**

- `apps/web/src/features/courses/CourseDetailPage.tsx` — tab "Notas"
- `apps/web/src/features/students/StudentDetailPage.tsx` — sección notas

---

## Task 1: Schema — modelos Subject y Grade

**Files:**

- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Añadir enum GradePeriod y modelos al schema**

En `apps/api/prisma/schema.prisma`, después de los enums existentes (antes de `// SCHOOL`), añadir:

```prisma
enum GradePeriod {
  P1   // Nota parcial 1 (sem 1)
  P2   // Nota parcial 2 (sem 1)
  E1   // Examen semestre 1
  P3   // Nota parcial 3 (sem 2)
  P4   // Nota parcial 4 (sem 2)
  E2   // Examen semestre 2
  NF   // Nota final (calculada, almacenada para histórico)
}
```

En el modelo `Course` (línea ~264), añadir en las relaciones:

```prisma
  subjects    Subject[]
```

En el modelo `Student` (línea ~306), añadir:

```prisma
  grades      Grade[]
```

En el modelo `User` (línea ~144), añadir:

```prisma
  gradesRecorded Grade[] @relation("GradeRecordedBy")
```

Al final del schema, después de `AttendanceJustification`, añadir:

```prisma
// =============================================================================
// SUBJECTS + GRADES
// =============================================================================

model Subject {
  id           String   @id @default(uuid()) @db.Char(36)
  schoolId     String   @db.Char(36)
  courseId     String   @db.Char(36)
  name         String   @db.VarChar(120)
  code         String   @db.VarChar(20)
  teacherId    String?  @db.Char(36)
  semester     Int      @default(0)       // 0=anual, 1=solo sem1, 2=solo sem2
  hoursPerWeek Int      @default(4)
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  school   School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  course   Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  teacher  User?    @relation("SubjectTeacher", fields: [teacherId], references: [id], onDelete: SetNull)
  grades   Grade[]

  @@unique([courseId, code])
  @@index([courseId])
  @@index([schoolId])
  @@map("subjects")
}

model Grade {
  id           String      @id @default(uuid()) @db.Char(36)
  studentId    String      @db.Char(36)
  subjectId    String      @db.Char(36)
  period       GradePeriod
  value        Decimal     @db.Decimal(4, 1) // 1.0–7.0
  comment      String?     @db.VarChar(200)
  recordedById String      @db.Char(36)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  student      Student @relation(fields: [studentId], references: [id], onDelete: Cascade)
  subject      Subject @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  recordedBy   User    @relation("GradeRecordedBy", fields: [recordedById], references: [id])

  @@unique([studentId, subjectId, period])
  @@index([subjectId])
  @@index([studentId])
  @@map("grades")
}
```

También añadir la relación inversa de `User` para `SubjectTeacher`:

```prisma
  subjectsTeaching Subject[] @relation("SubjectTeacher")
```

- [ ] **Step 2: Migrar y generar cliente**

```bash
pnpm --filter @asistencia/api exec prisma migrate dev --name add-subjects-grades
pnpm --filter @asistencia/api exec prisma generate
```

Expected: migración SQL creada, cliente regenerado con `subject`/`grade` disponibles.

---

## Task 2: SubjectsModule — backend

**Files:**

- Create: `apps/api/src/subjects/dto/create-subject.dto.ts`
- Create: `apps/api/src/subjects/subjects.service.ts`
- Create: `apps/api/src/subjects/subjects.controller.ts`
- Create: `apps/api/src/subjects/subjects.module.ts`

- [ ] **Step 1: DTO**

Crear `apps/api/src/subjects/dto/create-subject.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateSubjectDto {
  @ApiProperty({ example: 'Matemáticas' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'MAT' })
  @IsString()
  @MaxLength(20)
  code!: string;

  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional({ default: 0, description: '0=anual, 1=sem1, 2=sem2' })
  @IsOptional()
  @IsInt()
  semester?: number;

  @ApiPropertyOptional({ default: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  hoursPerWeek?: number;
}
```

- [ ] **Step 2: Service**

Crear `apps/api/src/subjects/subjects.service.ts`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateSubjectDto } from './dto/create-subject.dto.js';

@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByCourse(courseId: string) {
    return this.prisma.subject.findMany({
      where: { courseId, active: true },
      include: {
        teacher: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { grades: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateSubjectDto) {
    const exists = await this.prisma.subject.findUnique({
      where: { courseId_code: { courseId: dto.courseId, code: dto.code } },
    });
    if (exists) throw new ConflictException(`Código ${dto.code} ya existe en este curso`);
    return this.prisma.subject.create({
      data: {
        schoolId: dto.schoolId,
        courseId: dto.courseId,
        name: dto.name,
        code: dto.code,
        semester: dto.semester ?? 0,
        hoursPerWeek: dto.hoursPerWeek ?? 4,
        ...(dto.teacherId ? { teacherId: dto.teacherId } : {}),
      },
    });
  }

  async update(id: string, dto: Partial<CreateSubjectDto>) {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('Asignatura no encontrada');
    return this.prisma.subject.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.teacherId !== undefined ? { teacherId: dto.teacherId } : {}),
        ...(dto.hoursPerWeek !== undefined ? { hoursPerWeek: dto.hoursPerWeek } : {}),
        ...(dto.semester !== undefined ? { semester: dto.semester } : {}),
      },
    });
  }

  async remove(id: string) {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('Asignatura no encontrada');
    return this.prisma.subject.update({ where: { id }, data: { active: false } });
  }
}
```

- [ ] **Step 3: Controller**

Crear `apps/api/src/subjects/subjects.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { SubjectsService } from './subjects.service.js';
import { CreateSubjectDto } from './dto/create-subject.dto.js';

@ApiTags('subjects')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Asignaturas de un curso' })
  findByCourse(@Query('courseId') courseId: string) {
    return this.subjects.findByCourse(courseId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Crear asignatura' })
  create(@Body() dto: CreateSubjectDto) {
    return this.subjects.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Actualizar asignatura' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateSubjectDto>) {
    return this.subjects.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Desactivar asignatura' })
  remove(@Param('id') id: string) {
    return this.subjects.remove(id);
  }
}
```

- [ ] **Step 4: Module**

Crear `apps/api/src/subjects/subjects.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SubjectsController } from './subjects.controller.js';
import { SubjectsService } from './subjects.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
```

---

## Task 3: GradesModule — backend

**Files:**

- Create: `apps/api/src/grades/dto/upsert-grades.dto.ts`
- Create: `apps/api/src/grades/grades.service.ts`
- Create: `apps/api/src/grades/grades.controller.ts`
- Create: `apps/api/src/grades/grades.module.ts`

- [ ] **Step 1: DTO**

Crear `apps/api/src/grades/dto/upsert-grades.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { GradePeriod } from '@prisma/client';

export class GradeEntryDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    enum: GradePeriod,
    description: 'NF no es ingresable — se calcula automáticamente',
  })
  @IsEnum(GradePeriod)
  @IsNotIn([GradePeriod.NF], {
    message: 'NF se calcula automáticamente y no puede ingresarse directamente',
  })
  period!: GradePeriod;

  @ApiProperty({ minimum: 1.0, maximum: 7.0 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1.0)
  @Max(7.0)
  value!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpsertGradesDto {
  @ApiProperty()
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ type: [GradeEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradeEntryDto)
  entries!: GradeEntryDto[];
}
```

- [ ] **Step 2: Service con cálculo NF**

Crear `apps/api/src/grades/grades.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { GradePeriod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

import type { UpsertGradesDto } from './dto/upsert-grades.dto.js';

// recordedById is injected by the controller from JWT — never accepted from client
export type UpsertGradesDtoWithUser = UpsertGradesDto & { recordedById: string };

/** Peso estándar MINEDUC: notas parciales 60%, examen 40% por semestre. */
function calcSemesterAvg(parciales: number[], examen: number | null): number | null {
  if (parciales.length === 0) return null;
  const avgParcial = parciales.reduce((a, b) => a + b, 0) / parciales.length;
  if (examen === null) return Math.round(avgParcial * 10) / 10;
  return Math.round((avgParcial * 0.6 + examen * 0.4) * 10) / 10;
}

function calcNF(s1: number | null, s2: number | null): number | null {
  if (s1 === null || s2 === null) return null;
  return Math.round(((s1 + s2) / 2) * 10) / 10;
}

@Injectable()
export class GradesService {
  constructor(private readonly prisma: PrismaService) {}

  async findBySubject(subjectId: string) {
    return this.prisma.grade.findMany({
      where: { subjectId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, enrollmentNumber: true } },
      },
      orderBy: [{ student: { enrollmentNumber: 'asc' } }, { period: 'asc' }],
    });
  }

  async findByStudent(studentId: string) {
    return this.prisma.grade.findMany({
      where: { studentId },
      include: {
        subject: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ subject: { name: 'asc' } }, { period: 'asc' }],
    });
  }

  async findByCourse(courseId: string) {
    const subjects = await this.prisma.subject.findMany({
      where: { courseId, active: true },
      include: {
        grades: {
          include: {
            student: {
              select: { id: true, firstName: true, lastName: true, enrollmentNumber: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return subjects;
  }

  async upsertBulk(dto: UpsertGradesDtoWithUser) {
    const subject = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
    if (!subject) throw new NotFoundException('Asignatura no encontrada');

    const ops = dto.entries.map((e) =>
      this.prisma.grade.upsert({
        where: {
          studentId_subjectId_period: {
            studentId: e.studentId,
            subjectId: dto.subjectId,
            period: e.period,
          },
        },
        create: {
          studentId: e.studentId,
          subjectId: dto.subjectId,
          period: e.period,
          value: new Prisma.Decimal(e.value),
          recordedById: dto.recordedById,
          ...(e.comment ? { comment: e.comment } : {}),
        },
        update: {
          value: new Prisma.Decimal(e.value),
          recordedById: dto.recordedById,
          ...(e.comment !== undefined ? { comment: e.comment } : {}),
        },
      }),
    );

    const saved = await this.prisma.$transaction(ops);

    // Recalcular NF para cada estudiante afectado
    const studentIds = [...new Set(dto.entries.map((e) => e.studentId))];
    for (const studentId of studentIds) {
      await this.recalcNF(studentId, dto.subjectId, dto.recordedById);
    }

    return { saved: saved.length };
  }

  private async recalcNF(studentId: string, subjectId: string, recordedById: string) {
    const grades = await this.prisma.grade.findMany({
      where: { studentId, subjectId },
      select: { period: true, value: true },
    });

    const val = (p: GradePeriod) => {
      const g = grades.find((g) => g.period === p);
      return g ? Number(g.value) : null;
    };

    const p1 = val(GradePeriod.P1),
      p2 = val(GradePeriod.P2),
      e1 = val(GradePeriod.E1);
    const p3 = val(GradePeriod.P3),
      p4 = val(GradePeriod.P4),
      e2 = val(GradePeriod.E2);

    const s1 = calcSemesterAvg(
      [p1, p2].filter((x): x is number => x !== null),
      e1,
    );
    const s2 = calcSemesterAvg(
      [p3, p4].filter((x): x is number => x !== null),
      e2,
    );
    const nf = calcNF(s1, s2);

    if (nf !== null) {
      await this.prisma.grade.upsert({
        where: { studentId_subjectId_period: { studentId, subjectId, period: GradePeriod.NF } },
        create: {
          studentId,
          subjectId,
          period: GradePeriod.NF,
          value: new Prisma.Decimal(nf),
          recordedById,
        },
        update: { value: new Prisma.Decimal(nf) },
      });
    }

    return { s1, s2, nf };
  }

  async getStudentGradeSummary(studentId: string) {
    const rawGrades = await this.findByStudent(studentId);

    const bySubject: Record<
      string,
      { subject: { id: string; name: string; code: string }; grades: Record<string, number> }
    > = {};
    for (const g of rawGrades) {
      const key = g.subjectId;
      bySubject[key] ??= { subject: g.subject, grades: {} };
      bySubject[key]!.grades[g.period] = Number(g.value);
    }
    return Object.values(bySubject);
  }
}
```

- [ ] **Step 3: Controller**

Crear `apps/api/src/grades/grades.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { GradesService } from './grades.service.js';
import { UpsertGradesDto } from './dto/upsert-grades.dto.js';

@ApiTags('grades')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('grades')
export class GradesController {
  constructor(private readonly grades: GradesService) {}

  @Get('course/:courseId')
  @ApiOperation({ summary: 'Todas las notas de un curso (por asignatura)' })
  findByCourse(@Param('courseId') courseId: string) {
    return this.grades.findByCourse(courseId);
  }

  @Get('subject/:subjectId')
  @ApiOperation({ summary: 'Notas de una asignatura' })
  findBySubject(@Param('subjectId') subjectId: string) {
    return this.grades.findBySubject(subjectId);
  }

  @Get('student/:studentId/summary')
  @ApiOperation({ summary: 'Resumen de notas del alumno por asignatura' })
  getStudentSummary(@Param('studentId') studentId: string) {
    return this.grades.getStudentGradeSummary(studentId);
  }

  @Put('bulk')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP, SystemRole.PROFESOR)
  @ApiOperation({ summary: 'Ingresar/actualizar notas masivamente para una asignatura' })
  upsertBulk(@Body() dto: UpsertGradesDto, @CurrentUser() user: JwtPayload) {
    // recordedById injected from JWT — never trusted from client body
    return this.grades.upsertBulk({ ...dto, recordedById: user.sub });
  }
}
```

- [ ] **Step 4: Module**

Crear `apps/api/src/grades/grades.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GradesController } from './grades.controller.js';
import { GradesService } from './grades.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [GradesController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
```

- [ ] **Step 5: Registrar en AppModule**

En `apps/api/src/app.module.ts`, añadir imports:

```typescript
import { SubjectsModule } from './subjects/subjects.module.js';
import { GradesModule } from './grades/grades.module.js';
```

Y en el array `imports: [...]` agregar `SubjectsModule, GradesModule,`.

- [ ] **Step 6: Typecheck API**

```bash
pnpm --filter @asistencia/api exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 4: Frontend — Tab "Notas" en CourseDetailPage

**Files:**

- Create: `apps/web/src/features/courses/components/GradesTab.tsx`
- Create: `apps/web/src/features/courses/components/SubjectsManager.tsx`
- Modify: `apps/web/src/features/courses/CourseDetailPage.tsx`

- [ ] **Step 1: Crear GradesTab**

Crear `apps/web/src/features/courses/components/GradesTab.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUser } from '@/stores/auth.store';

type Subject = {
  id: string;
  name: string;
  code: string;
  semester: number;
  teacher: { id: string; firstName: string; lastName: string } | null;
};

type GradeRow = {
  student: { id: string; firstName: string; lastName: string; enrollmentNumber: number };
  period: string;
  value: number;
  comment?: string;
};

type SubjectWithGrades = Subject & {
  grades: GradeRow[];
};

const PERIODS = ['P1', 'P2', 'E1', 'P3', 'P4', 'E2', 'NF'] as const;
const PERIOD_LABELS: Record<string, string> = {
  P1: 'Nota 1',
  P2: 'Nota 2',
  E1: 'Exam S1',
  P3: 'Nota 3',
  P4: 'Nota 4',
  E2: 'Exam S2',
  NF: 'N. Final',
};
const EDITABLE_PERIODS = PERIODS.filter((p) => p !== 'NF');

function gradeColor(v: number) {
  if (v >= 5.0) return 'text-green-600 dark:text-green-400';
  if (v >= 4.0) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

export function GradesTab({ courseId }: { courseId: string }) {
  const user = useUser();
  const qc = useQueryClient();
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [localGrades, setLocalGrades] = useState<Record<string, Record<string, string>>>({}); // studentId → period → value string
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r)) ?? false;
  const isProfesor = user?.roles.includes('PROFESOR') ?? false;
  const canEdit = isAdmin || isProfesor;

  const { data: subjectsWithGrades } = useQuery<SubjectWithGrades[]>({
    queryKey: ['grades-course', courseId],
    queryFn: () => api.get(`/grades/course/${courseId}`),
  });

  const selected =
    subjectsWithGrades?.find((s) => s.id === selectedSubjectId) ?? subjectsWithGrades?.[0];

  // Build student × period matrix from grades
  const students = (() => {
    if (!selected) return [];
    const map = new Map<string, { student: GradeRow['student']; grades: Record<string, number> }>();
    for (const g of selected.grades) {
      if (!map.has(g.student.id)) map.set(g.student.id, { student: g.student, grades: {} });
      map.get(g.student.id)!.grades[g.period] = g.value;
    }
    return [...map.values()].sort(
      (a, b) => a.student.enrollmentNumber - b.student.enrollmentNumber,
    );
  })();

  const saveMut = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Sin asignatura');
      const entries = Object.entries(localGrades).flatMap(([studentId, periods]) =>
        Object.entries(periods)
          .filter(([, v]) => v !== '' && !isNaN(Number(v)))
          .map(([period, value]) => ({
            studentId,
            period,
            value: Number(Number(value).toFixed(1)),
          })),
      );
      if (entries.length === 0) throw new Error('Sin cambios');
      return api.put('/grades/bulk', { subjectId: selected.id, entries });
    },
    onSuccess: () => {
      toast.success('Notas guardadas');
      setLocalGrades({});
      void qc.invalidateQueries({ queryKey: ['grades-course', courseId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const setLocal = (studentId: string, period: string, value: string) => {
    setLocalGrades((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? {}), [period]: value },
    }));
  };

  if (!subjectsWithGrades) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Cargando notas…</div>;
  }

  if (subjectsWithGrades.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-2">
        <p className="text-sm font-medium">Sin asignaturas</p>
        <p className="text-xs text-muted-foreground">
          Un administrador debe crear las asignaturas del curso primero.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Subject selector */}
      <div className="flex gap-2 flex-wrap">
        {subjectsWithGrades.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSelectedSubjectId(s.id);
              setLocalGrades({});
            }}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
              selected?.id === s.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            {s.code} — {s.name}
          </button>
        ))}
      </div>

      {selected && (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold">{selected.name}</p>
            {canEdit && Object.keys(localGrades).length > 0 && (
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              >
                {saveMut.isPending ? 'Guardando…' : 'Guardar notas'}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 w-8">#</th>
                  <th className="text-left px-4 py-2.5">Alumno</th>
                  {PERIODS.map((p) => (
                    <th key={p} className="text-center px-2 py-2.5 min-w-[64px]">
                      {PERIOD_LABELS[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map(({ student, grades }) => (
                  <tr key={student.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2 text-muted-foreground tabular-nums">
                      {student.enrollmentNumber}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {student.lastName}, {student.firstName}
                    </td>
                    {PERIODS.map((period) => {
                      const saved = grades[period];
                      const local = localGrades[student.id]?.[period];
                      const display = local ?? (saved !== undefined ? String(saved) : '');
                      const isNF = period === 'NF';
                      return (
                        <td key={period} className="px-1 py-1 text-center">
                          {isNF ? (
                            <span
                              className={cn(
                                'text-xs font-bold tabular-nums',
                                saved !== undefined ? gradeColor(saved) : 'text-muted-foreground',
                              )}
                            >
                              {saved !== undefined ? saved.toFixed(1) : '—'}
                            </span>
                          ) : canEdit ? (
                            <input
                              type="number"
                              min={1.0}
                              max={7.0}
                              step={0.1}
                              value={display}
                              onChange={(e) => setLocal(student.id, period, e.target.value)}
                              className={cn(
                                'w-14 text-center text-xs rounded border px-1 py-0.5 bg-background tabular-nums',
                                local !== undefined ? 'border-primary' : 'border-border',
                                saved !== undefined && local === undefined ? gradeColor(saved) : '',
                              )}
                              placeholder="—"
                            />
                          ) : (
                            <span
                              className={cn(
                                'text-xs tabular-nums',
                                saved !== undefined ? gradeColor(saved) : 'text-muted-foreground',
                              )}
                            >
                              {saved !== undefined ? saved.toFixed(1) : '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Crear SubjectsManager (solo admins)**

Crear `apps/web/src/features/courses/components/SubjectsManager.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';

type Subject = { id: string; name: string; code: string; hoursPerWeek: number; semester: number };

export function SubjectsManager({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const user = useUser();
  const schoolId = useEffectiveSchoolId();
  const isAdmin = user?.roles.some((r) => ['SUPER_ADMIN', 'DIRECTOR', 'UTP'].includes(r)) ?? false;
  const [form, setForm] = useState({ name: '', code: '', hoursPerWeek: 4, semester: 0 });
  const [showForm, setShowForm] = useState(false);

  const { data: subjects } = useQuery<Subject[]>({
    queryKey: ['subjects', courseId],
    queryFn: () => api.get(`/subjects?courseId=${courseId}`),
  });

  const createMut = useMutation({
    mutationFn: () => api.post('/subjects', { ...form, courseId, schoolId }),
    onSuccess: () => {
      toast.success('Asignatura creada');
      setShowForm(false);
      setForm({ name: '', code: '', hoursPerWeek: 4, semester: 0 });
      void qc.invalidateQueries({ queryKey: ['subjects', courseId] });
      void qc.invalidateQueries({ queryKey: ['grades-course', courseId] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del(`/subjects/${id}`),
    onSuccess: () => {
      toast.success('Asignatura eliminada');
      void qc.invalidateQueries({ queryKey: ['subjects', courseId] });
    },
  });

  if (!isAdmin) return null;

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <p className="text-sm font-semibold">Asignaturas del curso</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground"
        >
          + Añadir
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Nombre (ej: Matemáticas)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background col-span-2"
            />
            <input
              placeholder="Código (ej: MAT)"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
            />
            <input
              type="number"
              placeholder="Hrs/semana"
              min={1}
              max={12}
              value={form.hoursPerWeek}
              onChange={(e) => setForm({ ...form, hoursPerWeek: Number(e.target.value) })}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background"
            />
            <select
              value={form.semester}
              onChange={(e) => setForm({ ...form, semester: Number(e.target.value) })}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background col-span-2"
            >
              <option value={0}>Anual</option>
              <option value={1}>Solo 1er semestre</option>
              <option value={2}>Solo 2do semestre</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.name || !form.code || createMut.isPending}
              className="text-sm px-4 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            >
              {createMut.isPending ? 'Creando…' : 'Crear'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-sm px-4 py-1.5 rounded-lg border border-border hover:bg-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!subjects?.length ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">Sin asignaturas aún</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-4 py-2">Código</th>
              <th className="text-left px-4 py-2">Nombre</th>
              <th className="text-center px-4 py-2">Hrs</th>
              <th className="text-left px-4 py-2">Sem.</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-4 py-2.5 font-mono text-xs">{s.code}</td>
                <td className="px-4 py-2.5">{s.name}</td>
                <td className="px-4 py-2.5 text-center">{s.hoursPerWeek}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {s.semester === 0 ? 'Anual' : `Sem. ${s.semester}`}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <button
                    onClick={() => deleteMut.mutate(s.id)}
                    className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Añadir tab "Notas" a CourseDetailPage**

En `apps/web/src/features/courses/CourseDetailPage.tsx`:

Añadir imports al inicio:

```tsx
import { GradesTab } from './components/GradesTab';
import { SubjectsManager } from './components/SubjectsManager';
```

Cambiar el estado de `activeTab` — incluir ya el tab `horario` (que añade el plan siguiente):

```tsx
const [activeTab, setActiveTab] = useState<'asistencia' | 'notas' | 'horario' | 'estadisticas'>(
  'asistencia',
);
```

En el tab bar, reemplazar la definición existente con los 4 tabs definitivos:

```tsx
{
  (['asistencia', 'notas', 'horario', 'estadisticas'] as const).map((tab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={cn(
        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
        activeTab === tab
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {
        {
          asistencia: 'Asistencia',
          notas: 'Notas',
          horario: 'Horario',
          estadisticas: 'Estadísticas',
        }[tab]
      }
    </button>
  ));
}
```

En el bloque condicional de renderizado, añadir los nuevos tabs antes del bloque `estadisticas`:

```tsx
{activeTab === 'notas' ? (
  <div className="space-y-4">
    <SubjectsManager courseId={courseId} />
    <GradesTab courseId={courseId} />
  </div>
) : activeTab === 'horario' ? (
  // Placeholder — implementado en plan 2026-04-23-horarios.md
  <div className="p-8 text-center text-muted-foreground text-sm">Horario — próximamente</div>
) : activeTab === 'estadisticas' ? (
```

- [ ] **Step 4: Añadir resumen de notas a StudentDetailPage**

En `apps/web/src/features/students/StudentDetailPage.tsx`, añadir query y sección debajo del gráfico mensual:

```tsx
const { data: gradeSummary } = useQuery({
  queryKey: ['student-grades', studentId],
  queryFn: () =>
    api.get<Array<{ subject: { name: string; code: string }; grades: Record<string, number> }>>(
      `/grades/student/${studentId}/summary`,
    ),
});
```

Y en el JSX, después del gráfico mensual:

```tsx
{
  gradeSummary && gradeSummary.length > 0 && (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold">Notas</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-5 py-3">Asignatura</th>
              {['P1', 'P2', 'E1', 'P3', 'P4', 'E2'].map((p) => (
                <th key={p} className="text-center px-2 py-3 min-w-[48px]">
                  {p}
                </th>
              ))}
              <th className="text-center px-3 py-3 font-bold">NF</th>
            </tr>
          </thead>
          <tbody>
            {gradeSummary.map((row) => (
              <tr key={row.subject.code} className="border-t border-border hover:bg-muted/20">
                <td className="px-5 py-2.5">
                  <span className="font-medium">{row.subject.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground font-mono">
                    {row.subject.code}
                  </span>
                </td>
                {['P1', 'P2', 'E1', 'P3', 'P4', 'E2'].map((p) => {
                  const v = row.grades[p];
                  return (
                    <td key={p} className="px-2 py-2.5 text-center text-xs tabular-nums">
                      {v !== undefined ? (
                        <span
                          className={
                            v >= 5
                              ? 'text-green-600 dark:text-green-400'
                              : v >= 4
                                ? 'text-yellow-600 dark:text-yellow-400'
                                : 'text-red-600 dark:text-red-400'
                          }
                        >
                          {v.toFixed(1)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-center">
                  {row.grades['NF'] !== undefined ? (
                    <span
                      className={`text-sm font-bold tabular-nums ${row.grades['NF']! >= 4 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                    >
                      {row.grades['NF']!.toFixed(1)}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck web**

```bash
pnpm --filter @asistencia/web exec tsc --noEmit
```

Expected: 0 errors.

---

## Task 5: Build y deploy

- [ ] **Step 1: Build API y web**

```bash
pnpm --filter @asistencia/api build && pnpm --filter @asistencia/web build
```

- [ ] **Step 2: Aplicar migración en VPS**

```bash
VPS="root@45.55.214.153"
DB_PASS=$(grep DB_PASSWORD .env.prod | cut -d= -f2)
MIGRATION=$(ls apps/api/prisma/migrations/ | grep subjects | tail -1)
scp "apps/api/prisma/migrations/${MIGRATION}/migration.sql" $VPS:/tmp/migration_subjects.sql
ssh $VPS "docker exec asistencia_db mysql -u asistencia_app -p'${DB_PASS}' asistencia < /tmp/migration_subjects.sql && echo ok"
```

- [ ] **Step 3: Copiar Prisma client al contenedor**

```bash
tar -czf /tmp/prisma-client.tar.gz \
  --exclude='libquery_engine-rhel-*' \
  --exclude='libquery_engine-linux-musl-*' \
  --exclude='libquery_engine-darwin-*' \
  -C node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client .
scp /tmp/prisma-client.tar.gz $VPS:/tmp/
ssh $VPS "docker cp /tmp/prisma-client.tar.gz asistencia_api:/tmp/ && docker exec -u 0 asistencia_api sh -c 'cd /app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client && tar -xzf /tmp/prisma-client.tar.gz && echo prisma-ok'"
```

- [ ] **Step 4: Deploy dists y reiniciar**

```bash
tar -czf /tmp/api-dist.tar.gz -C apps/api/dist .
tar -czf /tmp/web-dist.tar.gz -C apps/web/dist .
scp /tmp/api-dist.tar.gz /tmp/web-dist.tar.gz $VPS:/tmp/
ssh $VPS "
  docker cp /tmp/api-dist.tar.gz asistencia_api:/tmp/ &&
  docker exec -u 0 asistencia_api sh -c 'cd /app/apps/api && rm -rf dist && mkdir dist && tar -xzf /tmp/api-dist.tar.gz -C dist' &&
  docker cp /tmp/web-dist.tar.gz asistencia_web:/tmp/ &&
  docker exec -u 0 asistencia_web sh -c 'rm -rf /usr/share/nginx/html/* && tar -xzf /tmp/web-dist.tar.gz -C /usr/share/nginx/html' &&
  docker restart asistencia_api &&
  echo deployed
"
```

- [ ] **Step 5: Verificar**

```bash
curl -s https://asistencia.nicoholas.dev/api/v1/health | python3 -m json.tool
```

Expected: `{"status":"ok","info":{"database":{"status":"up"}}}`.
