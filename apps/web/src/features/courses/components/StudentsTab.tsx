import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Shield, ShieldOff } from 'lucide-react';
import { useState } from 'react';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type StudentStat = {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string;
  rut: string;
  enrollmentNumber: number;
  total: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  rate: number | null;
};

type MatrixData = {
  students: StudentStat[];
  dates: string[];
  matrix: Record<string, Record<string, string>>;
};

type Guardian = {
  guardianId: string;
  isPrimary: boolean;
  guardian: { id: string; email: string; firstName: string; lastName: string };
};

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function RateBar({ rate }: { rate: number | null }) {
  const pct = rate != null ? Math.round(rate * 100) : null;
  const color =
    rate == null
      ? 'bg-muted'
      : rate >= 0.9
        ? 'bg-green-500'
        : rate >= 0.7
          ? 'bg-amber-500'
          : 'bg-red-500';
  const textColor =
    rate == null
      ? 'text-muted-foreground'
      : rate >= 0.9
        ? 'text-green-700 dark:text-green-400'
        : rate >= 0.7
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-red-700 dark:text-red-400';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      <span className={cn('text-xs tabular-nums font-semibold w-9 text-right shrink-0', textColor)}>
        {pct != null ? `${pct}%` : '—'}
      </span>
    </div>
  );
}

type SortKey = 'enrollmentNumber' | 'lastName' | 'rate';
type SortDir = 'asc' | 'desc';

export function StudentsTab({ courseId }: { courseId: string }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [sortKey, setSortKey] = useState<SortKey>('enrollmentNumber');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [guardianFilter, setGuardianFilter] = useState<'all' | 'without'>('all');

  const { data: matrix, isLoading } = useQuery<MatrixData>({
    queryKey: ['attendance-matrix', courseId, year, month],
    queryFn: () => api.get(`/attendance/course/${courseId}/matrix?year=${year}&month=${month}`),
  });

  const { data: guardianMap } = useQuery<Record<string, Guardian[]>>({
    queryKey: ['course-guardians', courseId],
    queryFn: async () => {
      const students = matrix?.students ?? [];
      const results = await Promise.all(
        students.map((s) =>
          api.get<Guardian[]>(`/students/${s.id}/guardians`).then((g) => [s.id, g] as const),
        ),
      );
      return Object.fromEntries(results);
    },
    enabled: !!matrix?.students.length,
    staleTime: 1000 * 60 * 5,
  });

  const sort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const students = [...(matrix?.students ?? [])]
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'enrollmentNumber') cmp = a.enrollmentNumber - b.enrollmentNumber;
      else if (sortKey === 'lastName')
        cmp = `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`);
      else if (sortKey === 'rate') cmp = (a.rate ?? -1) - (b.rate ?? -1);
      return sortDir === 'asc' ? cmp : -cmp;
    })
    .filter((s) => {
      if (guardianFilter === 'without') return !(guardianMap?.[s.id]?.length ?? 0);
      return true;
    });

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-1 opacity-40 text-[10px]">
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  const totalStudents = matrix?.students.length ?? 0;
  const withoutGuardian = Object.values(guardianMap ?? {}).filter((g) => !g.length).length;
  const atRisk = (matrix?.students ?? []).filter((s) => s.rate !== null && s.rate < 0.7).length;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total alumnos', value: totalStudents, sub: 'matriculados' },
          {
            label: 'Sin apoderado',
            value: withoutGuardian,
            sub: 'sin asignar',
            warn: withoutGuardian > 0,
          },
          { label: 'En riesgo', value: atRisk, sub: '< 70% asistencia', warn: atRisk > 0 },
          { label: 'Mes actual', value: MONTH_NAMES[month - 1], sub: `año ${year}` },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-background p-3">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p
              className={cn(
                'text-xl font-bold mt-0.5 tabular-nums',
                stat.warn ? 'text-amber-600 dark:text-amber-400' : '',
              )}
            >
              {stat.value}
            </p>
            <p className="text-xs text-muted-foreground">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filtrar:</span>
        <button
          onClick={() => setGuardianFilter('all')}
          className={cn(
            'text-xs px-3 py-1.5 rounded-lg border transition',
            guardianFilter === 'all'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border hover:bg-muted',
          )}
        >
          Todos
        </button>
        <button
          onClick={() => setGuardianFilter('without')}
          className={cn(
            'text-xs px-3 py-1.5 rounded-lg border transition',
            guardianFilter === 'without'
              ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'border-border hover:bg-muted',
          )}
        >
          Sin apoderado ({withoutGuardian})
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <div className="data-scroll data-scroll-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th
                  className="text-left px-4 py-3 w-10 cursor-pointer hover:text-foreground select-none"
                  onClick={() => sort('enrollmentNumber')}
                >
                  # <SortIcon k="enrollmentNumber" />
                </th>
                <th
                  className="text-left px-4 py-3 cursor-pointer hover:text-foreground select-none"
                  onClick={() => sort('lastName')}
                >
                  Alumno <SortIcon k="lastName" />
                </th>
                <th className="text-left px-4 py-3 w-28 hidden sm:table-cell">RUT</th>
                <th
                  className="text-left px-4 py-3 w-40 cursor-pointer hover:text-foreground select-none"
                  onClick={() => sort('rate')}
                >
                  Asistencia {MONTH_NAMES[month - 1]} <SortIcon k="rate" />
                </th>
                <th className="text-center px-4 py-3 w-24 hidden md:table-cell">Apoderado</th>
                <th className="text-center px-4 py-3 w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const guardians = guardianMap?.[student.id] ?? [];
                const primaryGuardian = guardians.find((g) => g.isPrimary) ?? guardians[0];
                return (
                  <tr
                    key={student.id}
                    className="border-t border-border hover:bg-muted/20 transition group"
                  >
                    <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">
                      {student.enrollmentNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <Link
                          to="/alumnos/$studentId"
                          params={{ studentId: student.id }}
                          search={{ courseId }}
                          className="font-medium hover:text-primary transition-colors truncate block"
                        >
                          {student.lastName}
                          {student.secondLastName ? ` ${student.secondLastName}` : ''},{' '}
                          {student.firstName}
                        </Link>
                        <div className="md:hidden mt-0.5">
                          {primaryGuardian ? (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Shield className="size-3 text-green-500" />
                              {primaryGuardian.guardian.firstName}{' '}
                              {primaryGuardian.guardian.lastName}
                            </span>
                          ) : (
                            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <ShieldOff className="size-3" />
                              Sin apoderado
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">{student.rut}</span>
                    </td>
                    <td className="px-4 py-3">
                      {student.total > 0 ? (
                        <div className="space-y-1">
                          <RateBar rate={student.rate} />
                          <p className="text-xs text-muted-foreground">
                            {(student.present ?? 0) + (student.late ?? 0)}/{student.total} días
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin registros</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center hidden md:table-cell">
                      {primaryGuardian ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                            <Shield className="size-3" />
                            {primaryGuardian.guardian.firstName}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                          <ShieldOff className="size-3" />
                          Sin asignar
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Link
                          to="/alumnos/$studentId"
                          params={{ studentId: student.id }}
                          search={{ courseId }}
                          className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition"
                          title="Ver perfil"
                          aria-label={`Ver perfil de ${student.firstName} ${student.lastName}`}
                        >
                          <ExternalLink className="size-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {students.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {guardianFilter === 'without'
                      ? 'Todos los alumnos tienen apoderado asignado.'
                      : 'No hay alumnos matriculados en este curso.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
