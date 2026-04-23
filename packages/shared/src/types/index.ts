import type { AttendanceStatus, Role } from '../constants/index.js';

export interface UserPublic {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface Course {
  id: string;
  code: string; // ej. "1A", "2B"
  name: string; // ej. "1° Básico A"
  level: string; // ej. "Básica", "Media"
  year: number;
  headTeacherId?: string | null;
  studentCount: number;
}

export interface Student {
  id: string;
  rut: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  birthDate?: string | null;
  courseId: string;
  enrollmentNumber: number;
  active: boolean;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  courseId: string;
  date: string; // ISO yyyy-mm-dd
  status: AttendanceStatus;
  note?: string | null;
  recordedById: string;
  recordedAt: string;
}

export interface AttendanceDailySummary {
  date: string;
  courseId: string;
  totalStudents: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  attendanceRate: number; // 0..1
}

export interface CourseStats {
  courseId: string;
  periodFrom: string;
  periodTo: string;
  attendanceRate: number;
  absentRate: number;
  lateRate: number;
  justifiedRate: number;
}
