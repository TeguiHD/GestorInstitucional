import { Injectable, NotFoundException } from '@nestjs/common';
import type { AttendanceStatus } from '@prisma/client';

import { CalendarService } from '../calendar/calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PRESENT_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'JUSTIFIED'];
const DOW_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export interface Insight {
  type: 'dow_pattern' | 'risk_students' | 'trend' | 'streak' | 'best_course' | 'worst_course';
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  meta?: Record<string, unknown>;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
  ) {}

  async getCourseInsights(
    courseId: string,
    year: number,
    month: number,
  ): Promise<{
    course: { id: string; code: string; name: string };
    period: string;
    attendanceRate: number;
    insights: Insight[];
  }> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, code: true, name: true },
    });
    if (!course) throw new NotFoundException('Curso no encontrado');

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);
    const prevFrom = new Date(year, month - 2, 1);
    const prevTo = new Date(year, month - 1, 0, 23, 59, 59);

    const courseSchool = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const schoolId = courseSchool?.schoolId ?? '';

    const [currentRaw, previousRaw, nonSchool, nonSchoolPrev] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { courseId, date: { gte: from, lte: to } },
        select: {
          date: true,
          status: true,
          studentId: true,
          student: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { courseId, date: { gte: prevFrom, lte: prevTo } },
        select: { status: true, date: true },
      }),
      schoolId ? this.calendar.getNonSchoolDays(schoolId, from, to) : new Set<string>(),
      schoolId ? this.calendar.getNonSchoolDays(schoolId, prevFrom, prevTo) : new Set<string>(),
    ]);

    const current = currentRaw.filter((r) => !nonSchool.has(r.date.toISOString().split('T')[0]!));
    const previous = previousRaw.filter(
      (r) => !nonSchoolPrev.has(r.date.toISOString().split('T')[0]!),
    );

    const insights: Insight[] = [];
    const totalCurrent = current.length;
    const presentCurrent = current.filter((r) => PRESENT_STATUSES.includes(r.status)).length;
    const rateCurrent = totalCurrent > 0 ? presentCurrent / totalCurrent : 0;

    if (previous.length > 0) {
      const ratePrev =
        previous.filter((r) => PRESENT_STATUSES.includes(r.status)).length / previous.length;
      const delta = rateCurrent - ratePrev;
      if (Math.abs(delta) >= 0.03) {
        insights.push({
          type: 'trend',
          severity: delta < -0.05 ? 'warn' : 'info',
          title: delta > 0 ? 'Asistencia al alza' : 'Asistencia a la baja',
          detail: `${(Math.abs(delta) * 100).toFixed(1)}% vs ${MONTH_NAMES[prevFrom.getMonth()]} (${(ratePrev * 100).toFixed(1)}% → ${(rateCurrent * 100).toFixed(1)}%).`,
          meta: { delta, ratePrev, rateCurrent },
        });
      }
    }

    const byDow = new Map<number, { total: number; absent: number }>();
    for (const r of current) {
      const dow = r.date.getDay();
      const e = byDow.get(dow) ?? { total: 0, absent: 0 };
      e.total++;
      if (!PRESENT_STATUSES.includes(r.status)) e.absent++;
      byDow.set(dow, e);
    }
    const dowRates = Array.from(byDow.entries())
      .filter(([, v]) => v.total >= 3)
      .map(([dow, v]) => ({ dow, rate: v.absent / v.total, total: v.total }));
    if (dowRates.length > 0) {
      const worst = dowRates.sort((a, b) => b.rate - a.rate)[0]!;
      const avgRate = 1 - rateCurrent;
      if (worst.rate - avgRate >= 0.05 && worst.rate >= 0.15) {
        insights.push({
          type: 'dow_pattern',
          severity: 'warn',
          title: `Ausencia concentrada los ${DOW_NAMES[worst.dow]}`,
          detail: `${(worst.rate * 100).toFixed(1)}% de ausencia los ${DOW_NAMES[worst.dow]!.toLowerCase()} vs ${(avgRate * 100).toFixed(1)}% promedio.`,
          meta: { dow: worst.dow, rate: worst.rate },
        });
      }
    }

    const byStudent = new Map<string, { name: string; total: number; absent: number }>();
    for (const r of current) {
      const name = `${r.student.firstName} ${r.student.lastName}`;
      const e = byStudent.get(r.studentId) ?? { name, total: 0, absent: 0 };
      e.total++;
      if (!PRESENT_STATUSES.includes(r.status)) e.absent++;
      byStudent.set(r.studentId, e);
    }
    const atRisk = Array.from(byStudent.entries())
      .map(([id, v]) => ({ id, name: v.name, rate: 1 - v.absent / v.total, total: v.total }))
      .filter((s) => s.total >= 5 && s.rate < 0.7)
      .sort((a, b) => a.rate - b.rate);
    if (atRisk.length > 0) {
      const top = atRisk.slice(0, 5);
      insights.push({
        type: 'risk_students',
        severity: 'critical',
        title: `${atRisk.length} alumno${atRisk.length > 1 ? 's' : ''} bajo 70%`,
        detail:
          top.map((s) => `${s.name} (${(s.rate * 100).toFixed(0)}%)`).join(', ') +
          (atRisk.length > 5 ? '…' : '.'),
        meta: { students: atRisk },
      });
    }

    const streaks = await this.detectStreaks(courseId, from, to);
    if (streaks.length > 0) {
      const top = streaks.slice(0, 3);
      insights.push({
        type: 'streak',
        severity: 'warn',
        title: `Racha de ausencias detectada`,
        detail: top.map((s) => `${s.name}: ${s.length} días seguidos`).join('; ') + '.',
        meta: { streaks: top },
      });
    }

    return {
      course,
      period: `${MONTH_NAMES[from.getMonth()]} ${year}`,
      attendanceRate: rateCurrent,
      insights: insights.sort((a, b) => this.sevRank(b.severity) - this.sevRank(a.severity)),
    };
  }

  async getSchoolInsights(
    schoolId: string,
    year: number,
    month: number,
  ): Promise<{
    period: string;
    overallRate: number;
    insights: Insight[];
  }> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const courses = await this.prisma.course.findMany({
      where: { schoolId, active: true },
      select: { id: true, code: true, name: true },
    });

    const nonSchool = await this.calendar.getNonSchoolDays(schoolId, from, to);
    const stats = await Promise.all(
      courses.map(async (c) => {
        const recsRaw = await this.prisma.attendanceRecord.findMany({
          where: { courseId: c.id, date: { gte: from, lte: to } },
          select: { status: true, date: true },
        });
        const recs = recsRaw.filter((r) => !nonSchool.has(r.date.toISOString().split('T')[0]!));
        const total = recs.length;
        const present = recs.filter((r) => PRESENT_STATUSES.includes(r.status)).length;
        return { ...c, total, rate: total > 0 ? present / total : 0 };
      }),
    );
    const active = stats.filter((s) => s.total > 0);

    const totalAll = active.reduce((a, s) => a + s.total, 0);
    const presentAll = active.reduce((a, s) => a + s.rate * s.total, 0);
    const overall = totalAll > 0 ? presentAll / totalAll : 0;

    const insights: Insight[] = [];
    const sorted = [...active].sort((a, b) => b.rate - a.rate);
    if (sorted.length > 0) {
      const best = sorted[0]!;
      const worst = sorted[sorted.length - 1]!;
      insights.push({
        type: 'best_course',
        severity: 'info',
        title: `Mejor curso: ${best.code}`,
        detail: `${best.name} lidera con ${(best.rate * 100).toFixed(1)}% de asistencia.`,
        meta: { course: best },
      });
      if (worst.rate < 0.85 && worst.id !== best.id) {
        insights.push({
          type: 'worst_course',
          severity: worst.rate < 0.7 ? 'critical' : 'warn',
          title: `Curso con menor asistencia: ${worst.code}`,
          detail: `${worst.name} en ${(worst.rate * 100).toFixed(1)}%. Recomendable intervención.`,
          meta: { course: worst },
        });
      }
    }

    return {
      period: `${MONTH_NAMES[from.getMonth()]} ${year}`,
      overallRate: overall,
      insights,
    };
  }

  async getAtRiskStudents(schoolId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const nonSchool = await this.calendar.getNonSchoolDays(schoolId, from, to);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        student: { schoolId, active: true },
        date: { gte: from, lte: to },
      },
      select: {
        studentId: true,
        status: true,
        date: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            rut: true,
            course: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    const filtered = records.filter((r) => !nonSchool.has(r.date.toISOString().split('T')[0]!));

    const byStudent = new Map<
      string,
      { student: (typeof filtered)[0]['student']; total: number; absent: number }
    >();
    for (const r of filtered) {
      const e = byStudent.get(r.studentId) ?? { student: r.student, total: 0, absent: 0 };
      e.total++;
      if (!PRESENT_STATUSES.includes(r.status)) e.absent++;
      byStudent.set(r.studentId, e);
    }

    const atRisk = Array.from(byStudent.values())
      .map((v) => ({ ...v.student, total: v.total, attendanceRate: 1 - v.absent / v.total }))
      .filter((s) => s.total >= 5 && s.attendanceRate < 0.7)
      .sort((a, b) => a.attendanceRate - b.attendanceRate);

    return {
      period: `${MONTH_NAMES[from.getMonth()]} ${year}`,
      count: atRisk.length,
      students: atRisk,
    };
  }

  async getWeekdayHeatmap(schoolId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        course: { schoolId, active: true },
        date: { gte: from, lte: to },
      },
      select: {
        date: true,
        status: true,
        course: { select: { code: true } },
      },
    });

    const matrix: Record<string, Record<number, { total: number; present: number }>> = {};
    const PRESENT = new Set<AttendanceStatus>(['PRESENT', 'LATE']);

    for (const r of records) {
      const dow = r.date.getDay();
      if (dow === 0 || dow === 6) continue;
      const courseKey = r.course.code;
      if (!matrix[courseKey]) matrix[courseKey] = {};
      const courseMatrix = matrix[courseKey]!;
      if (!courseMatrix[dow]) courseMatrix[dow] = { total: 0, present: 0 };
      const cell = courseMatrix[dow]!;
      cell.total++;
      if (PRESENT.has(r.status)) cell.present++;
    }

    return Object.entries(matrix)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([course, days]) => ({
        course,
        days: [1, 2, 3, 4, 5].map((d) => {
          const cell = days[d];
          return {
            dow: d,
            rate: cell && cell.total > 0 ? cell.present / cell.total : null,
          };
        }),
      }));
  }

  async getRiskPrediction(schoolId: string) {
    const now = new Date();
    const weeks = Array.from({ length: 4 }, (_, i) => {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { start, end };
    }).reverse();

    const firstWeek = weeks[0];
    const lastWeek = weeks[weeks.length - 1];
    if (!firstWeek || !lastWeek) return [];

    const from = firstWeek.start;
    const to = lastWeek.end;

    const [students, allRecords] = await Promise.all([
      this.prisma.student.findMany({
        where: { schoolId, active: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          rut: true,
          course: { select: { code: true } },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { student: { schoolId, active: true }, date: { gte: from, lte: to } },
        select: { studentId: true, date: true, status: true },
      }),
    ]);

    const PRESENT = new Set<AttendanceStatus>(['PRESENT', 'LATE']);
    const results = [];

    for (const student of students) {
      const weekRates: number[] = weeks.map(({ start, end }) => {
        const recs = allRecords.filter(
          (r) => r.studentId === student.id && r.date >= start && r.date <= end,
        );
        if (!recs.length) return NaN;
        return recs.filter((r) => PRESENT.has(r.status)).length / recs.length;
      });

      const valid = weekRates.filter((r) => !isNaN(r));
      if (valid.length < 2) continue;

      const avgRate = valid.reduce((a, b) => a + b, 0) / valid.length;
      if (avgRate >= 0.85) continue;

      const n = valid.length;
      const xs = valid.map((_, i) => i);
      const meanX = xs.reduce((a, b) => a + b, 0) / n;
      const meanY = valid.reduce((a, b) => a + b, 0) / n;
      const denom = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
      const slope =
        denom > 0 ? xs.reduce((s, x, i) => s + (x - meanX) * (valid[i]! - meanY), 0) / denom : 0;

      results.push({
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        rut: student.rut,
        course: student.course.code,
        avgRate: Math.round(avgRate * 1000) / 1000,
        slope: Math.round(slope * 1000) / 1000,
        risk:
          slope < -0.02
            ? 'high'
            : slope < 0
              ? 'medium'
              : ('stable' as 'high' | 'medium' | 'stable'),
        weekRates,
      });
    }

    return results.sort((a, b) => a.avgRate - b.avgRate).slice(0, 20);
  }

  private async detectStreaks(
    courseId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ studentId: string; name: string; length: number }>> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { schoolId: true },
    });
    const nonSchool = course
      ? await this.calendar.getNonSchoolDays(course.schoolId, from, to)
      : new Set<string>();
    const allRecords = await this.prisma.attendanceRecord.findMany({
      where: { courseId, date: { gte: from, lte: to } },
      orderBy: [{ studentId: 'asc' }, { date: 'asc' }],
      select: {
        studentId: true,
        date: true,
        status: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    const records = allRecords.filter((r) => !nonSchool.has(r.date.toISOString().split('T')[0]!));

    const byStudent = new Map<
      string,
      { name: string; dates: Array<{ date: Date; absent: boolean }> }
    >();
    for (const r of records) {
      const name = `${r.student.firstName} ${r.student.lastName}`;
      const e = byStudent.get(r.studentId) ?? { name, dates: [] };
      e.dates.push({ date: r.date, absent: !PRESENT_STATUSES.includes(r.status) });
      byStudent.set(r.studentId, e);
    }

    const streaks: Array<{ studentId: string; name: string; length: number }> = [];
    for (const [id, data] of byStudent) {
      let max = 0;
      let cur = 0;
      for (const d of data.dates) {
        if (d.absent) {
          cur++;
          if (cur > max) max = cur;
        } else cur = 0;
      }
      if (max >= 3) streaks.push({ studentId: id, name: data.name, length: max });
    }
    return streaks.sort((a, b) => b.length - a.length);
  }

  private sevRank(s: Insight['severity']): number {
    return s === 'critical' ? 3 : s === 'warn' ? 2 : 1;
  }
}
