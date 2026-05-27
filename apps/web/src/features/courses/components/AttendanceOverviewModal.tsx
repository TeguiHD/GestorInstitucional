import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  FileCheck,
} from 'lucide-react';
import { useState } from 'react';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type MonthSummary = {
  date: string;
  present: number;
  absent: number;
  late: number;
  justified: number;
  total: number;
  attendanceRate: number;
};

type AttendanceRecord = {
  id: string;
  status: string;
  note?: string;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    enrollmentNumber: number;
    rut: string;
  };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseName: string;
};

const STATUS_CONFIG = {
  PRESENT: {
    label: 'Presente',
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    icon: CheckCircle2,
  },
  ABSENT: {
    label: 'Ausente',
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    icon: XCircle,
  },
  LATE: {
    label: 'Atraso',
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-400',
    icon: Clock,
  },
  JUSTIFIED: {
    label: 'Justificado',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-400',
    icon: FileCheck,
  },
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  const day = new Date(year, month - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getRateColor(rate: number | null): string {
  if (rate === null) return 'bg-slate-100 dark:bg-slate-800';
  if (rate >= 0.9) return 'bg-green-500';
  if (rate >= 0.75) return 'bg-green-400';
  if (rate >= 0.6) return 'bg-yellow-400';
  if (rate >= 0.4) return 'bg-orange-400';
  return 'bg-red-500';
}

function getRateBgClass(rate: number | null): string {
  if (rate === null) return 'bg-slate-50 dark:bg-slate-900/50';
  if (rate >= 0.9) return 'bg-green-50 dark:bg-green-950/30';
  if (rate >= 0.75) return 'bg-green-50/50 dark:bg-green-950/20';
  if (rate >= 0.6) return 'bg-yellow-50 dark:bg-yellow-950/30';
  if (rate >= 0.4) return 'bg-orange-50 dark:bg-orange-950/30';
  return 'bg-red-50 dark:bg-red-950/30';
}

export function AttendanceOverviewModal({ open, onOpenChange, courseId, courseName }: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: monthSummary, isLoading: summaryLoading } = useQuery<MonthSummary[]>({
    queryKey: ['attendance-month-summary', courseId, viewYear, viewMonth],
    queryFn: () =>
      api.get(`/attendance/course/${courseId}/month?year=${viewYear}&month=${viewMonth}`),
    enabled: open,
  });

  const { data: dayRecords, isLoading: dayLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-day-detail', courseId, selectedDate],
    queryFn: () => api.get(`/attendance/course/${courseId}?date=${selectedDate}`),
    enabled: open && !!selectedDate,
  });

  const summaryMap = new Map(monthSummary?.map((s) => [s.date, s]) ?? []);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else {
      setViewMonth(viewMonth - 1);
    }
    setSelectedDate(null);
  };

  const nextMonth = () => {
    if (viewMonth === 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(viewMonth + 1);
    }
    setSelectedDate(null);
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth() + 1);
    setSelectedDate(null);
  };

  const monthName = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
  });

  const selectedDayData = selectedDate ? summaryMap.get(selectedDate) : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 lg:p-8">
          <div className="relative w-full max-w-5xl max-h-[90vh] bg-background rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-200">
            <div
              className="px-6 py-5 flex items-center justify-between flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #008269 0%, #004d40 100%)' }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-10 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
                  <Calendar className="size-5 text-white" />
                </div>
                <div className="min-w-0">
                  <Dialog.Title className="text-lg font-bold text-white truncate">
                    {courseName}
                  </Dialog.Title>
                  <p className="text-white/70 text-sm">Vista general de asistencia</p>
                </div>
              </div>
              <Dialog.Close className="size-9 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition">
                <X className="size-5 text-white" />
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    onClick={prevMonth}
                    className="size-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <h2 className="text-lg font-semibold capitalize min-w-[180px] text-center">
                    {monthName}
                  </h2>
                  <button
                    onClick={nextMonth}
                    className="size-9 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
                <button
                  onClick={goToToday}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition"
                >
                  Hoy
                </button>
              </div>

              <div className="rounded-xl border border-border bg-background overflow-hidden">
                <div className="grid grid-cols-7 gap-px bg-border">
                  {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
                    <div
                      key={day}
                      className="bg-muted/50 px-2 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-px bg-border">
                  {Array.from({ length: firstDay }).map((_, i) => (
                    <div
                      key={`empty-${i}`}
                      className="bg-background min-h-[80px] sm:min-h-[100px]"
                    />
                  ))}

                  {summaryLoading
                    ? Array.from({ length: daysInMonth }).map((_, i) => (
                        <div
                          key={`skeleton-${i}`}
                          className="bg-background min-h-[80px] sm:min-h-[100px] p-2 animate-pulse"
                        >
                          <div className="h-4 w-6 bg-muted rounded mb-2" />
                          <div className="h-2 w-full bg-muted rounded" />
                        </div>
                      ))
                    : Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const dateStr = formatDate(viewYear, viewMonth, day);
                        const dayData = summaryMap.get(dateStr);
                        const isSelected = selectedDate === dateStr;
                        const isToday =
                          viewYear === today.getFullYear() &&
                          viewMonth === today.getMonth() + 1 &&
                          day === today.getDate();

                        return (
                          <button
                            key={day}
                            onClick={() => setSelectedDate(dateStr)}
                            className={cn(
                              'bg-background min-h-[80px] sm:min-h-[100px] p-2 text-left transition-all hover:bg-muted/50 relative',
                              isSelected && 'ring-2 ring-primary ring-inset',
                              isToday && 'bg-primary/5',
                            )}
                          >
                            <div className="flex items-start justify-between mb-1.5">
                              <span
                                className={cn(
                                  'text-sm font-semibold',
                                  isToday ? 'text-primary' : 'text-foreground',
                                )}
                              >
                                {day}
                              </span>
                              {isToday && <span className="size-1.5 rounded-full bg-primary" />}
                            </div>

                            {dayData ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1">
                                  <div
                                    className={cn(
                                      'h-1.5 flex-1 rounded-full',
                                      getRateColor(dayData.attendanceRate),
                                    )}
                                  />
                                </div>
                                <div className="hidden sm:flex flex-wrap gap-1">
                                  {dayData.present > 0 && (
                                    <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
                                      {dayData.present}P
                                    </span>
                                  )}
                                  {dayData.absent > 0 && (
                                    <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
                                      {dayData.absent}A
                                    </span>
                                  )}
                                  {dayData.late > 0 && (
                                    <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400">
                                      {dayData.late}AT
                                    </span>
                                  )}
                                  {dayData.justified > 0 && (
                                    <span className="text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                                      {dayData.justified}J
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-muted-foreground sm:hidden">
                                  {(dayData.attendanceRate * 100).toFixed(0)}%
                                </p>
                              </div>
                            ) : (
                              <div className="text-[10px] text-muted-foreground/50">Sin datos</div>
                            )}
                          </button>
                        );
                      })}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-green-500" />
                  <span>90%+</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-green-400" />
                  <span>75-89%</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-yellow-400" />
                  <span>60-74%</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-orange-400" />
                  <span>40-59%</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-red-500" />
                  <span>&lt;40%</span>
                </div>
              </div>

              {selectedDate && (
                <div
                  className={cn(
                    'rounded-xl border border-border overflow-hidden animate-in slide-in-from-top-2 duration-200',
                    getRateBgClass(selectedDayData?.attendanceRate ?? null),
                  )}
                >
                  <div className="px-5 py-4 border-b border-border bg-background/50 backdrop-blur-sm">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h3 className="font-semibold text-base">
                          {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-CL', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </h3>
                        {selectedDayData && (
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {selectedDayData.total} registros ·{' '}
                            {(selectedDayData.attendanceRate * 100).toFixed(1)}% asistencia
                          </p>
                        )}
                      </div>
                      {selectedDayData && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium">
                            <CheckCircle2 className="size-3" />
                            {selectedDayData.present} presentes
                          </span>
                          {selectedDayData.absent > 0 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium">
                              <XCircle className="size-3" />
                              {selectedDayData.absent} ausentes
                            </span>
                          )}
                          {selectedDayData.late > 0 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-medium">
                              <Clock className="size-3" />
                              {selectedDayData.late} atrasos
                            </span>
                          )}
                          {selectedDayData.justified > 0 && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 text-xs font-medium">
                              <FileCheck className="size-3" />
                              {selectedDayData.justified} justificados
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-background">
                    {dayLoading ? (
                      <div className="p-4 space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="h-10 animate-pulse bg-muted rounded-lg" />
                        ))}
                      </div>
                    ) : !dayRecords || dayRecords.length === 0 ? (
                      <div className="p-8 text-center">
                        <Users className="size-10 text-muted-foreground/40 mx-auto mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">
                          Sin registros de asistencia
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          No se ha registrado asistencia para este día
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border max-h-[400px] overflow-y-auto data-scroll">
                        {dayRecords.map((record) => {
                          const statusKey = record.status as keyof typeof STATUS_CONFIG;
                          const config = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.PRESENT;
                          const Icon = config.icon;
                          return (
                            <div
                              key={record.id}
                              className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition"
                            >
                              <div
                                className={cn(
                                  'size-9 rounded-lg flex items-center justify-center flex-shrink-0',
                                  config.bg,
                                )}
                              >
                                <Icon className={cn('size-4', config.text)} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {record.student.lastName}, {record.student.firstName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  N° {record.student.enrollmentNumber} · {record.student.rut}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  'px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0',
                                  config.bg,
                                  config.text,
                                )}
                              >
                                {config.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
