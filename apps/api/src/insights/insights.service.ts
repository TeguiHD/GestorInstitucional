import { Injectable, NotFoundException } from '@nestjs/common';
import type { AttendanceStatus } from '@prisma/client';

import {
  addAttendanceStatus,
  buildAttendanceSummary,
  countsAsAttendance,
  emptyAttendanceCounts,
  type AttendanceCounts,
} from '../attendance/attendance-calculation.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolConfigService, type DateRange } from '../school-config/school-config.service.js';

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
    private readonly schoolConfig: SchoolConfigService,
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
      select: { id: true, code: true, name: true, schoolId: true },
    });
    if (!course) throw new NotFoundException('Curso no encontrado');

    const periodRange = this.limitRangeToToday({
      from: new Date(year, month - 1, 1),
      to: new Date(year, month, 0, 23, 59, 59, 999),
    });
    const previousRange = this.limitRangeToToday({
      from: new Date(year, month - 2, 1),
      to: new Date(year, month - 1, 0, 23, 59, 59, 999),
    });

    const [currentStudents, previousStudents, nonSchool, nonSchoolPrev] = await Promise.all([
      periodRange
        ? this.prisma.student.findMany({
            where: {
              courseId,
              ...this.schoolConfig.activeDuringRangesWhere([periodRange]),
            },
            select: this.studentPeriodSelect(),
          })
        : Promise.resolve([]),
      previousRange
        ? this.prisma.student.findMany({
            where: {
              courseId,
              ...this.schoolConfig.activeDuringRangesWhere([previousRange]),
            },
            select: this.studentPeriodSelect(),
          })
        : Promise.resolve([]),
      periodRange
        ? this.calendar.getNonSchoolDays(course.schoolId, periodRange.from, periodRange.to)
        : Promise.resolve(new Set<string>()),
      previousRange
        ? this.calendar.getNonSchoolDays(course.schoolId, previousRange.from, previousRange.to)
        : Promise.resolve(new Set<string>()),
    ]);

    const [currentRaw, previousRaw] = await Promise.all([
      periodRange
        ? this.prisma.attendanceRecord.findMany({
            where: {
              courseId,
              date: { gte: periodRange.from, lte: periodRange.to },
              studentId: { in: currentStudents.map((s) => s.id) },
            },
            select: {
              date: true,
              status: true,
              studentId: true,
              student: { select: { firstName: true, lastName: true } },
            },
          })
        : Promise.resolve([]),
      previousRange
        ? this.prisma.attendanceRecord.findMany({
            where: {
              courseId,
              date: { gte: previousRange.from, lte: previousRange.to },
              studentId: { in: previousStudents.map((s) => s.id) },
            },
            select: { status: true, date: true },
          })
        : Promise.resolve([]),
    ]);

    const current = this.filterSchoolRecords(currentRaw, nonSchool);
    const previous = this.filterSchoolRecords(previousRaw, nonSchoolPrev);
    const currentRanges = periodRange ? [periodRange] : [];
    const previousRanges = previousRange ? [previousRange] : [];
    const currentSummary = this.summaryForRecords(
      current,
      currentStudents,
      currentRanges,
      nonSchool,
    );
    const previousSummary = this.summaryForRecords(
      previous,
      previousStudents,
      previousRanges,
      nonSchoolPrev,
    );

    const insights: Insight[] = [];
    const rateCurrent = currentSummary.attendanceRate ?? 0;

    if (previousSummary.totalClasses > 0 && currentSummary.totalClasses > 0) {
      const ratePrev = previousSummary.attendanceRate ?? 0;
      const delta = rateCurrent - ratePrev;
      if (Math.abs(delta) >= 0.03) {
        insights.push({
          type: 'trend',
          severity: delta < -0.05 ? 'warn' : 'info',
          title: delta > 0 ? 'Asistencia al alza' : 'Asistencia a la baja',
          detail: `${(Math.abs(delta) * 100).toFixed(1)}% vs ${MONTH_NAMES[new Date(year, month - 2, 1).getMonth()]} (${(ratePrev * 100).toFixed(1)}% → ${(rateCurrent * 100).toFixed(1)}%).`,
          meta: { delta, ratePrev, rateCurrent },
        });
      }
    }

    const byDow = this.activeDayCountsByDow(currentStudents, currentRanges, nonSchool);
    for (const r of current) {
      const dow = r.date.getDay();
      const e = byDow.get(dow);
      if (!e) continue;
      if (countsAsAttendance(r.status)) e.attended++;
      byDow.set(dow, e);
    }
    const dowRates = Array.from(byDow.entries())
      .filter(([, v]) => v.total >= 3)
      .map(([dow, v]) => ({ dow, rate: 1 - v.attended / v.total, total: v.total }));
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

    const byStudent = new Map<
      string,
      {
        name: string;
        student: (typeof currentStudents)[number];
        counts: AttendanceCounts;
      }
    >();
    for (const student of currentStudents) {
      byStudent.set(student.id, {
        name: `${student.firstName} ${student.lastName}`,
        student,
        counts: emptyAttendanceCounts(),
      });
    }
    for (const r of current) {
      const e = byStudent.get(r.studentId);
      if (!e) continue;
      addAttendanceStatus(e.counts, r.status);
    }
    const atRisk = Array.from(byStudent.entries())
      .map(([id, v]) => {
        const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
          v.student,
          currentRanges,
          nonSchool,
        );
        const summary = buildAttendanceSummary(v.counts, totalClasses);
        return {
          id,
          name: v.name,
          rate: summary.attendanceRate ?? 0,
          total: summary.totalClasses,
          totalClasses: summary.totalClasses,
          missing: summary.missing,
        };
      })
      .filter((s) => s.totalClasses >= 5 && s.rate < 0.7)
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

    const streaks = periodRange
      ? await this.detectStreaks(courseId, periodRange.from, periodRange.to)
      : [];
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
      course: { id: course.id, code: course.code, name: course.name },
      period: `${MONTH_NAMES[month - 1]} ${year}`,
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
    const monthStart = new Date(year, month - 1, 1);
    const range = this.limitRangeToToday({
      from: monthStart,
      to: new Date(year, month, 0, 23, 59, 59, 999),
    });

    const courses = await this.prisma.course.findMany({
      where: { schoolId, active: true },
      select: {
        id: true,
        code: true,
        name: true,
        students: range
          ? {
              where: this.schoolConfig.activeDuringRangesWhere([range]),
              select: this.studentPeriodSelect(),
            }
          : { where: { id: { in: [] } }, select: this.studentPeriodSelect() },
      },
    });

    const nonSchool = range
      ? await this.calendar.getNonSchoolDays(schoolId, range.from, range.to)
      : new Set<string>();
    const records = range
      ? await this.prisma.attendanceRecord.findMany({
          where: {
            course: { schoolId, active: true },
            date: { gte: range.from, lte: range.to },
          },
          select: { courseId: true, status: true, date: true },
        })
      : [];
    const recordsByCourse = new Map<string, typeof records>();
    for (const record of this.filterSchoolRecords(records, nonSchool)) {
      const bucket = recordsByCourse.get(record.courseId) ?? [];
      bucket.push(record);
      recordsByCourse.set(record.courseId, bucket);
    }

    const ranges = range ? [range] : [];
    const stats = courses.map((course) => {
      const summary = this.summaryForRecords(
        recordsByCourse.get(course.id) ?? [],
        course.students,
        ranges,
        nonSchool,
      );
      return {
        id: course.id,
        code: course.code,
        name: course.name,
        total: summary.totalClasses,
        totalClasses: summary.totalClasses,
        attended: summary.attended,
        missing: summary.missing,
        rate: summary.attendanceRate ?? 0,
      };
    });
    const active = stats.filter((s) => s.totalClasses > 0);

    const totalAll = active.reduce((a, s) => a + s.totalClasses, 0);
    const presentAll = active.reduce((a, s) => a + s.attended, 0);
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
      period: `${MONTH_NAMES[monthStart.getMonth()]} ${year}`,
      overallRate: overall,
      insights,
    };
  }

  async getAtRiskStudents(schoolId: string, year: number, month: number) {
    const monthStart = new Date(year, month - 1, 1);
    const range = this.limitRangeToToday({
      from: monthStart,
      to: new Date(year, month, 0, 23, 59, 59, 999),
    });

    const students = range
      ? await this.prisma.student.findMany({
          where: {
            schoolId,
            ...this.schoolConfig.activeDuringRangesWhere([range]),
          },
          select: {
            ...this.studentPeriodSelect(),
            rut: true,
            course: { select: { id: true, name: true, code: true } },
          },
        })
      : [];

    const nonSchool = range
      ? await this.calendar.getNonSchoolDays(schoolId, range.from, range.to)
      : new Set<string>();

    const records = range
      ? await this.prisma.attendanceRecord.findMany({
          where: {
            studentId: { in: students.map((s) => s.id) },
            date: { gte: range.from, lte: range.to },
          },
          select: { studentId: true, status: true, date: true },
        })
      : [];

    const ranges = range ? [range] : [];
    const byStudent = new Map(students.map((student) => [student.id, emptyAttendanceCounts()]));
    for (const record of this.filterSchoolRecords(records, nonSchool)) {
      const counts = byStudent.get(record.studentId);
      if (counts) addAttendanceStatus(counts, record.status);
    }

    const atRisk = students
      .map((student) => {
        const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
          student,
          ranges,
          nonSchool,
        );
        const summary = buildAttendanceSummary(
          byStudent.get(student.id) ?? emptyAttendanceCounts(),
          totalClasses,
        );
        return {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          rut: student.rut,
          course: student.course,
          total: summary.totalClasses,
          totalClasses: summary.totalClasses,
          missing: summary.missing,
          attendanceRate: summary.attendanceRate ?? 0,
        };
      })
      .filter((s) => s.totalClasses >= 5 && s.attendanceRate < 0.7)
      .sort((a, b) => a.attendanceRate - b.attendanceRate);

    return {
      period: `${MONTH_NAMES[monthStart.getMonth()]} ${year}`,
      count: atRisk.length,
      students: atRisk,
    };
  }

  async getWeekdayHeatmap(schoolId: string, year: number, month: number) {
    const range = this.limitRangeToToday({
      from: new Date(year, month - 1, 1),
      to: new Date(year, month, 0, 23, 59, 59, 999),
    });

    const courses = await this.prisma.course.findMany({
      where: { schoolId, active: true },
      select: {
        id: true,
        code: true,
        students: range
          ? {
              where: this.schoolConfig.activeDuringRangesWhere([range]),
              select: this.studentPeriodSelect(),
            }
          : { where: { id: { in: [] } }, select: this.studentPeriodSelect() },
      },
    });
    const nonSchool = range
      ? await this.calendar.getNonSchoolDays(schoolId, range.from, range.to)
      : new Set<string>();

    const matrix: Record<string, Record<number, { total: number; present: number }>> = {};
    const ranges = range ? [range] : [];
    for (const course of courses) {
      matrix[course.code] = {};
      const byDow = this.activeDayCountsByDow(course.students, ranges, nonSchool);
      for (const [dow, cell] of byDow) {
        if (dow === 0 || dow === 6) continue;
        matrix[course.code]![dow] = { total: cell.total, present: 0 };
      }
    }

    const records = range
      ? await this.prisma.attendanceRecord.findMany({
          where: {
            course: { schoolId, active: true },
            date: { gte: range.from, lte: range.to },
          },
          select: {
            date: true,
            status: true,
            course: { select: { code: true } },
          },
        })
      : [];

    for (const r of this.filterSchoolRecords(records, nonSchool)) {
      const dow = r.date.getDay();
      if (dow === 0 || dow === 6) continue;
      const courseKey = r.course.code;
      if (!matrix[courseKey]) matrix[courseKey] = {};
      const courseMatrix = matrix[courseKey]!;
      if (!courseMatrix[dow]) courseMatrix[dow] = { total: 0, present: 0 };
      const cell = courseMatrix[dow]!;
      if (countsAsAttendance(r.status)) cell.present++;
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
    const now = this.endOfLocalDay(new Date());
    const weeks = Array.from({ length: 4 }, (_, i) => {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      const start = this.startOfLocalDay(end);
      start.setDate(start.getDate() - 6);
      return { start, end: this.endOfLocalDay(end) };
    }).reverse();

    const firstWeek = weeks[0];
    const lastWeek = weeks[weeks.length - 1];
    if (!firstWeek || !lastWeek) return [];

    const from = firstWeek.start;
    const to = lastWeek.end;

    const [students, allRecords, nonSchool] = await Promise.all([
      this.prisma.student.findMany({
        where: {
          schoolId,
          ...this.schoolConfig.activeDuringRangesWhere([{ from, to }]),
        },
        select: {
          ...this.studentPeriodSelect(),
          id: true,
          firstName: true,
          lastName: true,
          rut: true,
          course: { select: { code: true } },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { student: { schoolId }, date: { gte: from, lte: to } },
        select: { studentId: true, date: true, status: true },
      }),
      this.calendar.getNonSchoolDays(schoolId, from, to),
    ]);

    const filteredRecords = this.filterSchoolRecords(allRecords, nonSchool);
    const results = [];

    for (const student of students) {
      const weekRates: number[] = weeks.map(({ start, end }) => {
        const totalClasses = this.schoolConfig.countActiveSchoolDaysInRanges(
          student,
          [{ from: start, to: end }],
          nonSchool,
        );
        if (totalClasses === 0) return NaN;
        const recs = filteredRecords.filter(
          (r) => r.studentId === student.id && r.date >= start && r.date <= end,
        );
        return recs.filter((r) => countsAsAttendance(r.status)).length / totalClasses;
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

  private studentPeriodSelect() {
    return {
      id: true,
      firstName: true,
      lastName: true,
      enrolledAt: true,
      withdrawnAt: true,
    } as const;
  }

  private filterSchoolRecords<T extends { date: Date }>(
    records: T[],
    nonSchoolDays: Set<string>,
  ): T[] {
    return records.filter(
      (record) => !nonSchoolDays.has(this.schoolConfig.formatDate(record.date)),
    );
  }

  private summaryForRecords<T extends { status: AttendanceStatus | string | null | undefined }>(
    records: T[],
    students: Array<{ enrolledAt: Date; withdrawnAt: Date | null }>,
    ranges: DateRange[],
    nonSchoolDays: Set<string>,
  ) {
    const counts = emptyAttendanceCounts();
    for (const record of records) addAttendanceStatus(counts, record.status);
    const totalClasses = students.reduce(
      (sum, student) =>
        sum + this.schoolConfig.countActiveSchoolDaysInRanges(student, ranges, nonSchoolDays),
      0,
    );
    return buildAttendanceSummary(counts, totalClasses);
  }

  private activeDayCountsByDow(
    students: Array<{ enrolledAt: Date; withdrawnAt: Date | null }>,
    ranges: DateRange[],
    nonSchoolDays: Set<string>,
  ): Map<number, { total: number; attended: number }> {
    const byDow = new Map<number, { total: number; attended: number }>();
    for (const student of students) {
      for (const range of ranges) {
        const start = this.startOfLocalDay(
          student.enrolledAt > range.from ? student.enrolledAt : range.from,
        );
        const withdrawnEnd =
          student.withdrawnAt && student.withdrawnAt <= range.to
            ? this.addDays(this.startOfLocalDay(student.withdrawnAt), -1)
            : range.to;
        const end = this.startOfLocalDay(withdrawnEnd);
        const cursor = new Date(start);
        while (cursor <= end) {
          const dow = cursor.getDay();
          if (dow !== 0 && dow !== 6 && !nonSchoolDays.has(this.schoolConfig.formatDate(cursor))) {
            const cell = byDow.get(dow) ?? { total: 0, attended: 0 };
            cell.total++;
            byDow.set(dow, cell);
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      }
    }
    return byDow;
  }

  private limitRangeToToday(range: DateRange): DateRange | null {
    const today = this.endOfLocalDay(new Date());
    const to = range.to > today ? today : range.to;
    if (to < range.from) return null;
    return { from: range.from, to };
  }

  private startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
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
    const records = this.filterSchoolRecords(allRecords, nonSchool);

    const byStudent = new Map<
      string,
      { name: string; dates: Array<{ date: Date; absent: boolean }> }
    >();
    for (const r of records) {
      const name = `${r.student.firstName} ${r.student.lastName}`;
      const e = byStudent.get(r.studentId) ?? { name, dates: [] };
      e.dates.push({ date: r.date, absent: !countsAsAttendance(r.status) });
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
