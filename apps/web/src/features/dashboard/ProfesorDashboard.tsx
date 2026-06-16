import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Users,
  CalendarX,
} from 'lucide-react';

import { api } from '@/lib/api';
import { formatDateLocal } from '@/lib/date';
import { useUser } from '@/stores/auth.store';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { ATTENDANCE_THRESHOLDS } from '@asistencia/shared';

type CourseTeacher = {
  userId: string;
  isHead: boolean;
  user: { id: string; firstName: string; lastName: string };
};
type Course = {
  id: string;
  code: string;
  name: string;
  level: string;
  year: number;
  _count: { students: number };
  teachers: CourseTeacher[];
};

type AtRiskStudent = {
  id: string;
  firstName: string;
  lastName: string;
  rut: string;
  attendanceRate: number;
  course: { id: string; name: string; code: string };
};

type MissingAttendance = {
  courseId: string;
  courseCode: string;
  courseName: string;
  missingDates: string[];
};

function rateColor(rate: number): string {
  if (rate >= ATTENDANCE_THRESHOLDS.GOOD) return '#22c55e';
  if (rate >= ATTENDANCE_THRESHOLDS.WARN) return '#f59e0b';
  return '#ef4444';
}

export function ProfesorDashboard() {
  const user = useUser();
  const schoolId = useEffectiveSchoolId();
  const userId = user?.sub ?? '';

  const today = new Date();
  const todayStr = formatDateLocal(today);
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  const { data: allCourses, isLoading } = useQuery<Course[]>({
    queryKey: ['courses', schoolId],
    queryFn: () => api.get(`/courses?schoolId=${schoolId}&year=${year}`),
    enabled: !!schoolId,
  });

  const myCourses = allCourses?.filter((c) => c.teachers.some((t) => t.user.id === userId)) ?? [];

  const { data: atRisk } = useQuery<{ count: number; students: AtRiskStudent[] }>({
    queryKey: ['at-risk', schoolId, year, month],
    queryFn: () => api.get(`/insights/school/${schoolId}/at-risk?year=${year}&month=${month}`),
    enabled: !!schoolId,
  });

  const { data: allMissingAttendance } = useQuery<MissingAttendance[]>({
    queryKey: ['missing-attendance-prof', schoolId],
    queryFn: () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 30);
      return api.get(
        `/attendance/school/${schoolId}/missing?from=${formatDateLocal(from)}&to=${formatDateLocal(today)}`,
      );
    },
    enabled: !!schoolId,
  });

  const myAtRisk =
    atRisk?.students.filter((s) => myCourses.some((c) => c.id === s.course.id)) ?? [];

  const myMissingAttendance =
    allMissingAttendance?.filter((m) => myCourses.some((c) => c.id === m.courseId)) ?? [];
  const myTotalMissingDays = myMissingAttendance.reduce((sum, m) => sum + m.missingDates.length, 0);

  const totalStudents = myCourses.reduce((s, c) => s + c._count.students, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mis cursos</h1>
        <p className="text-sm text-muted-foreground">
          {today.toLocaleDateString('es-CL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-background p-5 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
            Cursos asignados
          </p>
          {isLoading ? (
            <div className="h-8 w-16 animate-pulse bg-muted rounded" />
          ) : (
            <p className="text-3xl font-bold text-primary">{myCourses.length}</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-background p-5 space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
            Alumnos totales
          </p>
          {isLoading ? (
            <div className="h-8 w-16 animate-pulse bg-muted rounded" />
          ) : (
            <p className="text-3xl font-bold text-foreground">{totalStudents}</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-background p-5 space-y-1 col-span-2 sm:col-span-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
            Alumnos en riesgo
          </p>
          {!atRisk ? (
            <div className="h-8 w-16 animate-pulse bg-muted rounded" />
          ) : (
            <p
              className="text-3xl font-bold"
              style={{ color: myAtRisk.length > 0 ? '#ef4444' : '#22c55e' }}
            >
              {myAtRisk.length}
            </p>
          )}
        </div>
      </div>

      {myTotalMissingDays > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-200 dark:border-amber-800/50 flex items-center gap-3">
            <div className="size-9 rounded-lg bg-amber-200 dark:bg-amber-800/50 flex items-center justify-center flex-shrink-0">
              <CalendarX className="size-4.5 text-amber-700 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Asistencia pendiente
              </h2>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {myMissingAttendance.length} curso{myMissingAttendance.length !== 1 ? 's' : ''} ·{' '}
                {myTotalMissingDays} día{myTotalMissingDays !== 1 ? 's' : ''} sin registro
              </p>
            </div>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-800/50">
            {myMissingAttendance.map((item) => (
              <div
                key={item.courseId}
                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-amber-100/30 dark:hover:bg-amber-900/10 transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {item.courseName}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    {item.missingDates.length} día{item.missingDates.length !== 1 ? 's' : ''}:{' '}
                    {item.missingDates
                      .slice(-3)
                      .reverse()
                      .map((d) =>
                        new Date(d + 'T12:00:00').toLocaleDateString('es-CL', {
                          day: 'numeric',
                          month: 'short',
                        }),
                      )
                      .join(', ')}
                  </p>
                </div>
                <Link
                  to="/cursos/$courseId"
                  params={{ courseId: item.courseId }}
                  search={{ focusDate: item.missingDates[0]! }}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-200 dark:bg-amber-800/50 text-amber-900 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700/50 transition"
                >
                  <ClipboardList className="size-3" />
                  Pasar lista
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Course cards */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Pasar lista hoy · {todayStr}</h2>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse bg-muted rounded-xl" />
            ))}
          </div>
        ) : myCourses.length === 0 ? (
          <div className="rounded-xl border border-border bg-background p-8 text-center text-sm text-muted-foreground">
            No tienes cursos asignados. Contacta a dirección o UTP.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myCourses.map((course) => (
              <CourseCard key={course.id} course={course} todayStr={todayStr} />
            ))}
          </div>
        )}
      </div>

      {/* At-risk students in my courses */}
      {myAtRisk.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 overflow-hidden">
          <div className="px-5 py-4 border-b border-destructive/20 flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <h2 className="text-sm font-semibold text-destructive">
              {myAtRisk.length} alumno{myAtRisk.length !== 1 ? 's' : ''} bajo 70% en tus cursos
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-destructive/5 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-5 py-2.5">Alumno</th>
                  <th className="text-left px-5 py-2.5">Curso</th>
                  <th className="text-right px-5 py-2.5">Asistencia</th>
                </tr>
              </thead>
              <tbody>
                {myAtRisk.slice(0, 8).map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-destructive/10 hover:bg-destructive/5 transition"
                  >
                    <td className="px-5 py-2.5">
                      <Link
                        to="/alumnos/$studentId"
                        params={{ studentId: s.id }}
                        className="font-medium hover:text-primary transition"
                      >
                        {s.lastName}, {s.firstName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{s.rut}</div>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-muted-foreground">{s.course.code}</td>
                    <td className="px-5 py-2.5 text-right">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: rateColor(s.attendanceRate) }}
                      >
                        {(s.attendanceRate * 100).toFixed(1)}%
                      </span>
                    </td>
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

function CourseCard({ course, todayStr }: { course: Course; todayStr: string }) {
  const { data: records } = useQuery<{ id: string }[]>({
    queryKey: ['attendance', course.id, todayStr],
    queryFn: () => api.get(`/attendance/course/${course.id}?date=${todayStr}`),
  });

  const markedToday = records !== undefined && records.length > 0;

  return (
    <div className="rounded-xl border border-border bg-background p-5 space-y-4 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <BookOpen className="size-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{course.name}</p>
          <p className="text-xs text-muted-foreground">
            {course.code} · {course._count.students} alumnos
          </p>
        </div>
      </div>

      {records !== undefined && (
        <div className="flex items-center gap-1.5 text-xs">
          {markedToday ? (
            <>
              <CheckCircle2 className="size-3.5 text-green-600" />
              <span className="text-green-600 font-medium">Asistencia marcada hoy</span>
            </>
          ) : (
            <>
              <ClipboardList className="size-3.5 text-amber-600" />
              <span className="text-amber-600 font-medium">Sin marcar hoy</span>
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-auto pt-1">
        <Link
          to="/cursos/$courseId"
          params={{ courseId: course.id }}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90 transition"
        >
          <Users className="size-3.5" />
          Pasar lista
        </Link>
        <Link
          to="/cursos/$courseId"
          params={{ courseId: course.id }}
          className="flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted transition"
          title="Ver curso"
        >
          <BookOpen className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
