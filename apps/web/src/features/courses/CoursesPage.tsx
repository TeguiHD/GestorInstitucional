import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  GraduationCap,
  Users,
  CalendarDays,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
} from 'lucide-react';
import { useState } from 'react';

import { api } from '@/lib/api';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { cn } from '@/lib/cn';
import { formatDateLocal } from '@/lib/date';
import { AttendanceOverviewModal } from './components/AttendanceOverviewModal';

type MissingAttendance = {
  courseId: string;
  courseCode: string;
  courseName: string;
  missingDates: string[];
};

type Course = {
  id: string;
  code: string;
  name: string;
  level: string;
  year: number;
  _count: { students: number };
  teachers: { user: { id: string; firstName: string; lastName: string }; isHead: boolean }[];
};

export function CoursesPage() {
  const schoolId = useEffectiveSchoolId();
  const [attendanceModal, setAttendanceModal] = useState<{
    courseId: string;
    courseName: string;
  } | null>(null);
  const [bannerExpanded, setBannerExpanded] = useState(false);

  const {
    data: courses,
    isLoading,
    isError,
    refetch,
  } = useQuery<Course[]>({
    queryKey: ['courses', schoolId],
    queryFn: () => api.get(`/courses?schoolId=${schoolId}&year=${new Date().getFullYear()}`),
    enabled: !!schoolId,
  });

  const { data: missingAttendance } = useQuery<MissingAttendance[]>({
    queryKey: ['missing-attendance', schoolId],
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

  const missingMap = new Map(missingAttendance?.map((m) => [m.courseId, m]) ?? []);
  const totalMissing = missingAttendance?.reduce((sum, m) => sum + m.missingDates.length, 0) ?? 0;

  const byLevel = courses?.reduce<Record<string, Course[]>>((acc, c) => {
    (acc[c.level] ??= []).push(c);
    return acc;
  }, {});

  const headTeacher = (course: Course) => {
    const head = course.teachers.find((t) => t.isHead) ?? course.teachers[0];
    return head ? `${head.user.firstName} ${head.user.lastName}` : null;
  };

  return (
    <div className="max-w-full space-y-6 overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Cursos</h1>
          {courses && (
            <p className="text-sm text-muted-foreground mt-1">
              {courses.length} curso{courses.length !== 1 ? 's' : ''} — año{' '}
              {new Date().getFullYear()}
            </p>
          )}
        </div>
      </div>

      {totalMissing > 0 && missingAttendance && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 overflow-hidden">
          <button
            onClick={() => setBannerExpanded(!bannerExpanded)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="size-9 rounded-lg bg-amber-200 dark:bg-amber-800/50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="size-4.5 text-amber-700 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {missingAttendance.length} curso{missingAttendance.length !== 1 ? 's' : ''} con
                  asistencia pendiente
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {totalMissing} día{totalMissing !== 1 ? 's' : ''} lectivo
                  {totalMissing !== 1 ? 's' : ''} sin registro en los últimos 30 días
                </p>
              </div>
            </div>
            {bannerExpanded ? (
              <ChevronUp className="size-4 text-amber-700 dark:text-amber-400 flex-shrink-0" />
            ) : (
              <ChevronDown className="size-4 text-amber-700 dark:text-amber-400 flex-shrink-0" />
            )}
          </button>

          {bannerExpanded && (
            <div className="border-t border-amber-200 dark:border-amber-800/50 divide-y divide-amber-200 dark:divide-amber-800/50 max-h-64 overflow-y-auto">
              {missingAttendance.map((item) => (
                <div
                  key={item.courseId}
                  className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-amber-100/30 dark:hover:bg-amber-900/10 transition"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      {item.courseName}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      {item.missingDates.length} día{item.missingDates.length !== 1 ? 's' : ''} sin
                      registro:{' '}
                      {item.missingDates
                        .slice(0, 3)
                        .map((d) =>
                          new Date(d + 'T12:00:00').toLocaleDateString('es-CL', {
                            day: 'numeric',
                            month: 'short',
                          }),
                        )
                        .join(', ')}
                      {item.missingDates.length > 3 && ` y ${item.missingDates.length - 3} más`}
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
          )}
        </div>
      )}

      {!schoolId ? (
        <EmptyState
          icon={GraduationCap}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a un colegio. Contacta a un administrador."
        />
      ) : isLoading ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="No se pudieron cargar los cursos." onRetry={() => refetch()} />
      ) : !courses?.length ? (
        <EmptyState
          icon={BookOpen}
          title="Sin cursos creados"
          description={`No hay cursos registrados para el año ${new Date().getFullYear()}.`}
        />
      ) : (
        Object.entries(byLevel ?? {}).map(([level, levelCourses]) => (
          <section key={level}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {level}
            </h2>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {levelCourses.map((course) => {
                const teacher = headTeacher(course);
                const missing = missingMap.get(course.id);
                return (
                  <div
                    key={course.id}
                    className={cn(
                      'group min-w-0 rounded-xl border bg-background p-5 hover:shadow-sm transition space-y-3',
                      missing
                        ? 'border-amber-300 dark:border-amber-700/50 hover:border-amber-400'
                        : 'border-border hover:border-primary/50',
                    )}
                  >
                    <Link to="/cursos/$courseId" params={{ courseId: course.id }} className="block">
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <BookOpen className="size-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold group-hover:text-primary transition truncate">
                            {course.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {course.code} · {course.year}
                          </p>
                        </div>
                        {missing && (
                          <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-semibold">
                            <AlertTriangle className="size-2.5" />
                            {missing.missingDates.length}d
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 mt-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="size-3.5 flex-shrink-0" />
                          <span>{course._count.students} alumnos</span>
                        </div>
                        {teacher && (
                          <p className="text-xs text-muted-foreground truncate">Prof. {teacher}</p>
                        )}
                      </div>
                    </Link>
                    <button
                      onClick={() =>
                        setAttendanceModal({ courseId: course.id, courseName: course.name })
                      }
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-border hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition"
                    >
                      <CalendarDays className="size-3.5" />
                      Ver asistencia
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {attendanceModal && (
        <AttendanceOverviewModal
          open={!!attendanceModal}
          onOpenChange={(open) => {
            if (!open) setAttendanceModal(null);
          }}
          courseId={attendanceModal.courseId}
          courseName={attendanceModal.courseName}
        />
      )}
    </div>
  );
}
