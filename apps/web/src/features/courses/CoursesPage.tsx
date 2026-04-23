import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, GraduationCap, Users } from 'lucide-react';

import { api } from '@/lib/api';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

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

  const byLevel = courses?.reduce<Record<string, Course[]>>((acc, c) => {
    (acc[c.level] ??= []).push(c);
    return acc;
  }, {});

  const headTeacher = (course: Course) => {
    const head = course.teachers.find((t) => t.isHead) ?? course.teachers[0];
    return head ? `${head.user.firstName} ${head.user.lastName}` : null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cursos</h1>
          {courses && (
            <p className="text-sm text-muted-foreground mt-1">
              {courses.length} curso{courses.length !== 1 ? 's' : ''} — año{' '}
              {new Date().getFullYear()}
            </p>
          )}
        </div>
      </div>

      {!schoolId ? (
        <EmptyState
          icon={GraduationCap}
          title="Sin colegio asignado"
          description="Tu cuenta no está vinculada a un colegio. Contacta a un administrador."
        />
      ) : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {levelCourses.map((course) => {
                const teacher = headTeacher(course);
                return (
                  <Link
                    key={course.id}
                    to="/cursos/$courseId"
                    params={{ courseId: course.id }}
                    className="group rounded-xl border border-border bg-background p-5 hover:border-primary/50 hover:shadow-sm transition space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <BookOpen className="size-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold group-hover:text-primary transition truncate">
                          {course.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {course.code} · {course.year}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="size-3.5 flex-shrink-0" />
                        <span>{course._count.students} alumnos</span>
                      </div>
                      {teacher && (
                        <p className="text-xs text-muted-foreground truncate">Prof. {teacher}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
