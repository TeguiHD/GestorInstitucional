import { z } from 'zod';

import { ATTENDANCE_STATUS, ROLES } from '../constants/index.js';

const rolesTuple = Object.values(ROLES) as [string, ...string[]];
const statusTuple = Object.values(ATTENDANCE_STATUS) as [string, ...string[]];

/** RUT chileno — normalizado (sin puntos, con guion). Validación dígito verificador se hace en backend. */
export const RutSchema = z
  .string()
  .regex(/^\d{7,8}-[\dkK]$/, 'RUT inválido — formato esperado 12345678-9');

/** Password policy NIST SP 800-63B: min 12, permite espacios, sin composición forzada. */
export const PasswordSchema = z
  .string()
  .min(12, 'Mínimo 12 caracteres')
  .max(128, 'Máximo 128 caracteres');

export const EmailSchema = z.string().email('Email inválido').max(255).toLowerCase();

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RegisterUserSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  roles: z.array(z.enum(rolesTuple)).min(1),
});
export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;

export const CreateCourseSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(120),
  level: z.string().min(1).max(40),
  year: z.number().int().gte(2000).lte(2100),
  headTeacherId: z.string().uuid().nullable().optional(),
});
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>;

export const CreateStudentSchema = z.object({
  rut: RutSchema,
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  secondLastName: z.string().max(80).nullable().optional(),
  birthDate: z.string().datetime().nullable().optional(),
  courseId: z.string().uuid(),
  enrollmentNumber: z.number().int().positive(),
});
export type CreateStudentInput = z.infer<typeof CreateStudentSchema>;

export const RecordAttendanceSchema = z.object({
  courseId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser YYYY-MM-DD'),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(statusTuple),
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1),
});
export type RecordAttendanceInput = z.infer<typeof RecordAttendanceSchema>;

export const AttendanceQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type AttendanceQueryInput = z.infer<typeof AttendanceQuerySchema>;
