import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useEffectiveSchoolId } from '@/stores/school.store';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

// ── Types ──────────────────────────────────────────────────────────────────────

type ActiveStudent = {
  id: string;
  firstName: string;
  lastName: string;
  rut: string;
  enrollmentNumber: number;
  enrolledAt: string;
  course: { id: string; code: string; name: string };
};

type WithdrawnStudent = {
  id: string;
  firstName: string;
  lastName: string;
  rut: string;
  enrollmentNumber: number;
  withdrawnAt: string | null;
  enrolledAt: string;
  course: { id: string; code: string; name: string };
};

type MovementEvent = {
  id: string;
  status: string;
  effectiveDate: string;
  reason: string | null;
  transferredToSchool: string | null;
  student: { id: string; firstName: string; lastName: string; rut: string };
  recordedBy: { id: string; firstName: string; lastName: string };
};

type Course = {
  id: string;
  code: string;
  name: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  ACTIVE: {
    label: 'Matrícula nueva',
    color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
  },
  TRANSFERRED_IN: {
    label: 'Traslado entrada',
    color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40',
  },
  TRANSFERRED_OUT: {
    label: 'Traslado salida',
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
  },
  WITHDRAWN: { label: 'Retiro', color: 'text-red-600 bg-red-50 dark:bg-red-950/40' },
  RE_ENROLLED: { label: 'Reingreso', color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40' },
  GRADUATED: { label: 'Egresado', color: 'text-slate-600 bg-slate-100 dark:bg-slate-800' },
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`;

const MONTHS = [
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

// ── Modal base ─────────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative z-10 w-full rounded-2xl border border-border bg-background p-6 shadow-xl',
          wide ? 'max-w-lg' : 'max-w-md',
        )}
      >
        <h2 className="mb-5 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
const selectCls =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

// ── Dialog: Matricular ─────────────────────────────────────────────────────────

function MatricularDialog({
  onClose,
  schoolId,
  courses,
}: {
  onClose: () => void;
  schoolId: string;
  courses: Course[];
}) {
  const qc = useQueryClient();

  const [rut, setRut] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [secondLastName, setSecondLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const [enrollmentNumber, setEnrollmentNumber] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]!);
  const [isTransfer, setIsTransfer] = useState(false);
  const [originSchool, setOriginSchool] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/students', {
        schoolId,
        courseId,
        rut,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        secondLastName: secondLastName.trim() || undefined,
        birthDate: birthDate || undefined,
        enrollmentNumber: enrollmentNumber ? Number(enrollmentNumber) : undefined,
        effectiveDate,
        transferOriginSchool: isTransfer ? originSchool.trim() : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school-active', schoolId] });
      qc.invalidateQueries({ queryKey: ['movements', schoolId] });
      toast.success('Alumno matriculado', {
        description: isTransfer ? `Traslado desde ${originSchool}` : undefined,
      });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title="Nueva Matrícula" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="RUT *">
            <input
              required
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              placeholder="12345678-9"
              className={inputCls}
            />
          </Field>
          <Field label="Fecha de nacimiento">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primer nombre *">
            <input
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Juan"
              className={inputCls}
            />
          </Field>
          <Field label="Apellido paterno *">
            <input
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="González"
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Apellido materno">
          <input
            value={secondLastName}
            onChange={(e) => setSecondLastName(e.target.value)}
            placeholder="Muñoz"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Curso *">
            <select
              required
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className={selectCls}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="N° lista (vacío = auto)">
            <input
              type="number"
              min={1}
              value={enrollmentNumber}
              onChange={(e) => setEnrollmentNumber(e.target.value)}
              placeholder="Auto"
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Fecha efectiva de matrícula *">
          <input
            required
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isTransfer}
            onChange={(e) => setIsTransfer(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Alumno proviene de otro establecimiento (traslado)
        </label>
        {isTransfer && (
          <Field label="Establecimiento de origen *">
            <input
              required={isTransfer}
              value={originSchool}
              onChange={(e) => setOriginSchool(e.target.value)}
              placeholder="Nombre del colegio de origen"
              className={inputCls}
            />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Matricular
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Dialog: Dar de Baja ────────────────────────────────────────────────────────

function DarDeBajaDialog({ student, onClose }: { student: ActiveStudent; onClose: () => void }) {
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]!);
  const [isTransfer, setIsTransfer] = useState(false);
  const [destinationSchool, setDestinationSchool] = useState('');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/students/${student.id}/withdraw`, {
        effectiveDate,
        reason: reason.trim() || undefined,
        transferType: isTransfer ? 'TRANSFERRED_OUT' : 'WITHDRAWN',
        transferredToSchool: isTransfer ? destinationSchool.trim() : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school-active', schoolId] });
      qc.invalidateQueries({ queryKey: ['withdrawn', schoolId] });
      qc.invalidateQueries({ queryKey: ['movements', schoolId] });
      toast.success(
        isTransfer ? `${fmtName(student)} trasladado` : `${fmtName(student)} dado de baja`,
        { description: isTransfer ? `→ ${destinationSchool}` : undefined },
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title={`Dar de baja — ${fmtName(student)}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <strong>{fmtName(student)}</strong> — {student.rut} · Curso{' '}
          <strong>{student.course.code}</strong>
        </div>
        <Field label="Fecha efectiva de retiro *">
          <input
            required
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Tipo de movimiento *</span>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!isTransfer}
              onChange={() => setIsTransfer(false)}
              className="accent-primary"
            />
            Retiro definitivo
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              checked={isTransfer}
              onChange={() => setIsTransfer(true)}
              className="accent-primary"
            />
            Traslado a otro establecimiento
          </label>
        </div>
        {isTransfer && (
          <Field label="Establecimiento destino *">
            <input
              required={isTransfer}
              value={destinationSchool}
              onChange={(e) => setDestinationSchool(e.target.value)}
              placeholder="Nombre del colegio destino"
              className={inputCls}
            />
          </Field>
        )}
        <Field label="Motivo (opcional)">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Cambio de domicilio"
            className={inputCls}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserMinus className="size-4" />
            )}
            {isTransfer ? 'Registrar traslado' : 'Dar de baja'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Dialog: Reingresar ─────────────────────────────────────────────────────────

function ReingresarDialog({
  student,
  onClose,
  courses,
}: {
  student: WithdrawnStudent;
  onClose: () => void;
  courses: Course[];
}) {
  const qc = useQueryClient();
  const schoolId = useEffectiveSchoolId();
  const [courseId, setCourseId] = useState(student.course.id);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split('T')[0]!);
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/students/${student.id}/re-enroll`, {
        courseId,
        effectiveDate,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school-active', schoolId] });
      qc.invalidateQueries({ queryKey: ['withdrawn', schoolId] });
      qc.invalidateQueries({ queryKey: ['movements', schoolId] });
      toast.success(`${fmtName(student)} reingresado`);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal title={`Reingresar — ${fmtName(student)}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
          <strong>{fmtName(student)}</strong> — {student.rut}
          {student.withdrawnAt && (
            <span className="ml-1 opacity-75">· retirado el {fmtDate(student.withdrawnAt)}</span>
          )}
        </div>
        <Field label="Curso de reingreso *">
          <select
            required
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className={selectCls}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha efectiva de reingreso *">
          <input
            required
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Observación (opcional)">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Retomó estudios"
            className={inputCls}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserCheck className="size-4" />
            )}
            Reingresar
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-6 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ── Tab: Activos ───────────────────────────────────────────────────────────────

function ActivesTab({ schoolId }: { schoolId: string }) {
  const [search, setSearch] = useState('');
  const [bajaTarget, setBajaTarget] = useState<ActiveStudent | null>(null);

  const q = useQuery<ActiveStudent[]>({
    queryKey: ['school-active', schoolId],
    queryFn: () => api.get(`/students/school-active?schoolId=${encodeURIComponent(schoolId)}`),
    enabled: !!schoolId,
  });

  if (q.isError) return <ErrorState message="Error al cargar alumnos activos" />;

  const filtered = (q.data ?? []).filter((s) => {
    const t = search.toLowerCase();
    return (
      !t ||
      s.firstName.toLowerCase().includes(t) ||
      s.lastName.toLowerCase().includes(t) ||
      s.rut.includes(t) ||
      s.course.code.toLowerCase().includes(t)
    );
  });

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, RUT o curso…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {q.isFetching && <RefreshCw className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {q.isLoading ? (
        <Skeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? 'Sin resultados para esa búsqueda' : 'No hay alumnos activos'}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">N°</th>
                  <th className="px-4 py-2.5 text-left font-medium">Nombre</th>
                  <th className="px-4 py-2.5 text-left font-medium">RUT</th>
                  <th className="px-4 py-2.5 text-left font-medium">Curso</th>
                  <th className="px-4 py-2.5 text-left font-medium">F. ingreso</th>
                  <th className="px-4 py-2.5 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {s.enrollmentNumber}
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {s.firstName} {s.lastName}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.rut}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {s.course.code}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(s.enrolledAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setBajaTarget(s)}
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40"
                      >
                        Dar de baja
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {filtered.length} alumno{filtered.length !== 1 ? 's' : ''}
            {search ? ` encontrado${filtered.length !== 1 ? 's' : ''}` : ' activos'}
          </div>
        </div>
      )}
      {bajaTarget && <DarDeBajaDialog student={bajaTarget} onClose={() => setBajaTarget(null)} />}
    </>
  );
}

// ── Tab: Retirados ─────────────────────────────────────────────────────────────

function WithdrawnTab({ schoolId, courses }: { schoolId: string; courses: Course[] }) {
  const [search, setSearch] = useState('');
  const [reingresarTarget, setReingresarTarget] = useState<WithdrawnStudent | null>(null);

  const q = useQuery<WithdrawnStudent[]>({
    queryKey: ['withdrawn', schoolId],
    queryFn: () => api.get(`/students/trash?schoolId=${encodeURIComponent(schoolId)}`),
    enabled: !!schoolId,
  });

  if (q.isError) return <ErrorState message="Error al cargar alumnos retirados" />;

  const filtered = (q.data ?? []).filter((s) => {
    const t = search.toLowerCase();
    return (
      !t ||
      s.firstName.toLowerCase().includes(t) ||
      s.lastName.toLowerCase().includes(t) ||
      s.rut.includes(t)
    );
  });

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o RUT…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        {q.isFetching && <RefreshCw className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {q.isLoading ? (
        <Skeleton />
      ) : filtered.length === 0 ? (
        <EmptyState title={search ? 'Sin resultados' : 'No hay alumnos retirados'} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Nombre</th>
                  <th className="px-4 py-2.5 text-left font-medium">RUT</th>
                  <th className="px-4 py-2.5 text-left font-medium">Último curso</th>
                  <th className="px-4 py-2.5 text-left font-medium">Fecha retiro</th>
                  <th className="px-4 py-2.5 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {s.firstName} {s.lastName}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.rut}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {s.course.code}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {s.withdrawnAt ? fmtDate(s.withdrawnAt) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setReingresarTarget(s)}
                        className="rounded-md border border-purple-200 px-2.5 py-1 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-50 dark:border-purple-800 dark:hover:bg-purple-950/40"
                      >
                        Reingresar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {filtered.length} alumno{filtered.length !== 1 ? 's' : ''} retirado
            {filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
      {reingresarTarget && (
        <ReingresarDialog
          student={reingresarTarget}
          onClose={() => setReingresarTarget(null)}
          courses={courses}
        />
      )}
    </>
  );
}

// ── Tab: Historial ─────────────────────────────────────────────────────────────

function HistorialTab({ schoolId }: { schoolId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const q = useQuery<MovementEvent[]>({
    queryKey: ['movements', schoolId, year, month],
    queryFn: () =>
      api.get(`/students/movements?schoolId=${encodeURIComponent(schoolId)}&from=${from}&to=${to}`),
    enabled: !!schoolId,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className={selectCls}
        >
          {MONTHS.map((m, i) => (
            <option key={i + 1} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={selectCls}
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        {q.isFetching && <RefreshCw className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {q.isLoading ? (
        <Skeleton />
      ) : q.isError ? (
        <ErrorState message="Error al cargar historial" />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title="Sin movimientos en este período" />
      ) : (
        <div className="space-y-2">
          {(q.data ?? []).map((ev) => {
            const meta = STATUS_META[ev.status] ?? {
              label: ev.status,
              color: 'text-muted-foreground bg-muted',
            };
            return (
              <div
                key={ev.id}
                className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn('rounded-full px-2 py-0.5 text-xs font-medium', meta.color)}
                    >
                      {meta.label}
                    </span>
                    <span className="text-sm font-medium">
                      {ev.student.firstName} {ev.student.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">{ev.student.rut}</span>
                  </div>
                  {ev.reason && <span className="text-xs text-muted-foreground">{ev.reason}</span>}
                  {ev.transferredToSchool && (
                    <span className="text-xs text-muted-foreground">
                      → {ev.transferredToSchool}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-0.5 text-xs text-muted-foreground sm:items-end">
                  <span>{fmtDate(ev.effectiveDate)}</span>
                  <span>
                    por {ev.recordedBy.firstName} {ev.recordedBy.lastName}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="text-right text-xs text-muted-foreground">
            {q.data!.length} movimiento{q.data!.length !== 1 ? 's' : ''} en el período
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type Tab = 'activos' | 'retirados' | 'historial';

const TABS: { id: Tab; label: string; icon: typeof ArrowLeftRight }[] = [
  { id: 'activos', label: 'Activos', icon: UserCheck },
  { id: 'retirados', label: 'Retirados', icon: UserMinus },
  { id: 'historial', label: 'Historial', icon: ArrowLeftRight },
];

export function MovimientosPage() {
  const schoolId = useEffectiveSchoolId();
  const year = new Date().getFullYear();
  const [tab, setTab] = useState<Tab>('activos');
  const [showMatricular, setShowMatricular] = useState(false);

  const coursesQ = useQuery<Course[]>({
    queryKey: ['courses', schoolId, year],
    queryFn: () => api.get(`/courses?schoolId=${encodeURIComponent(schoolId)}&year=${year}`),
    enabled: !!schoolId,
  });

  const courses = coursesQ.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos de Matrícula</h1>
          <p className="text-sm text-muted-foreground">
            Gestión de ingresos, retiros y traslados — normativa MINEDUC.
          </p>
        </div>
        <button
          onClick={() => setShowMatricular(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Nueva Matrícula
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'activos' && <ActivesTab schoolId={schoolId} />}
      {tab === 'retirados' && <WithdrawnTab schoolId={schoolId} courses={courses} />}
      {tab === 'historial' && <HistorialTab schoolId={schoolId} />}

      {/* Modal nueva matrícula */}
      {showMatricular && (
        <MatricularDialog
          onClose={() => setShowMatricular(false)}
          schoolId={schoolId}
          courses={courses}
        />
      )}
    </div>
  );
}
