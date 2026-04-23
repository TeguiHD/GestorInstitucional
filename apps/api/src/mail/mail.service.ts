import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailCategory, MailPriority, MailStatus, Prisma } from '@prisma/client';

import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import * as tpl from './mail.templates.js';

const BRAND_NAME = 'Colegio San Sebastián de Paine';

export type EnqueueInput = {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text?: string;
  category: MailCategory;
  priority?: MailPriority;
  dedupeKey?: string;
  schoolId?: string;
  relatedType?: string;
  relatedId?: string;
  scheduledFor?: Date;
};

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  get enabled(): boolean {
    return this.config.get('mail.enabled', { infer: true });
  }

  get dailyLimit(): number {
    return this.config.get('mail.dailyLimit', { infer: true });
  }

  async enqueue(input: EnqueueInput): Promise<{ id: string | null; deduped: boolean }> {
    if (!this.enabled) {
      this.log.debug(`Mail disabled — skip enqueue [${input.category}] ${input.to.email}`);
      return { id: null, deduped: false };
    }

    const data: Prisma.MailOutboxCreateInput = {
      toEmail: input.to.email,
      ...(input.to.name ? { toName: input.to.name } : {}),
      subject: input.subject.slice(0, 300),
      htmlBody: input.html,
      ...(input.text ? { textBody: input.text } : {}),
      category: input.category,
      priority: input.priority ?? MailPriority.NORMAL,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      ...(input.schoolId ? { schoolId: input.schoolId } : {}),
      ...(input.relatedType ? { relatedType: input.relatedType } : {}),
      ...(input.relatedId ? { relatedId: input.relatedId } : {}),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    };

    try {
      const row = await this.prisma.mailOutbox.create({ data });
      return { id: row.id, deduped: false };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { id: null, deduped: true };
      }
      throw e;
    }
  }

  async enqueueBulk(inputs: EnqueueInput[]): Promise<{ enqueued: number; deduped: number }> {
    let enqueued = 0,
      deduped = 0;
    for (const i of inputs) {
      const r = await this.enqueue(i);
      if (r.deduped) deduped++;
      else if (r.id) enqueued++;
    }
    return { enqueued, deduped };
  }

  async quotaStatus(): Promise<{
    sentToday: number;
    limit: number;
    remaining: number;
    pending: number;
  }> {
    const today = startOfDay();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const [sentToday, pending] = await Promise.all([
      this.prisma.mailOutbox.count({
        where: { status: MailStatus.SENT, sentAt: { gte: today, lt: tomorrow } },
      }),
      this.prisma.mailOutbox.count({ where: { status: MailStatus.PENDING } }),
    ]);
    return {
      sentToday,
      limit: this.dailyLimit,
      remaining: Math.max(0, this.dailyLimit - sentToday),
      pending,
    };
  }

  async listRecent(filter: { status?: MailStatus; category?: MailCategory; limit?: number }) {
    return this.prisma.mailOutbox.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.category ? { category: filter.category } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: filter.limit ?? 50,
    });
  }

  async cancelPending(ids: string[]): Promise<number> {
    const r = await this.prisma.mailOutbox.updateMany({
      where: { id: { in: ids }, status: MailStatus.PENDING },
      data: { status: MailStatus.CANCELLED },
    });
    return r.count;
  }

  // Convenience builders — build template + enqueue
  async sendAbsenceDaily(params: {
    guardianId: string;
    guardianEmail: string;
    guardianName: string;
    studentName: string;
    courseName: string;
    recordId: string;
    date: Date;
    status: 'ABSENT' | 'LATE';
    lateMinutes?: number | null | undefined;
    schoolId: string;
  }) {
    const portalUrl = this.config
      .get('api.publicUrl', { infer: true })
      .replace(/\/api\/?$/, '')
      .replace(/\/v1$/, '');
    const webUrl = portalUrl.replace(':4000', ':5173');
    const { subject, html, text } = tpl.absenceDaily({
      guardianName: params.guardianName,
      studentName: params.studentName,
      courseName: params.courseName,
      date: params.date,
      status: params.status,
      ...(params.lateMinutes != null ? { lateMinutes: params.lateMinutes } : {}),
      portalUrl: webUrl,
    });
    return this.enqueue({
      to: { email: params.guardianEmail, name: params.guardianName },
      subject,
      html,
      text,
      category: MailCategory.ABSENCE_DAILY,
      priority: MailPriority.HIGH,
      dedupeKey: `absence:${params.recordId}:${params.guardianId}`,
      schoolId: params.schoolId,
      relatedType: 'AttendanceRecord',
      relatedId: params.recordId,
    });
  }

  async sendJustificationResult(params: {
    justificationId: string;
    guardianEmail: string;
    guardianName: string;
    studentName: string;
    date: Date;
    decision: 'APPROVED' | 'REJECTED';
    notes?: string | null | undefined;
    schoolId: string;
  }) {
    const webUrl = this.webUrl();
    const { subject, html, text } = tpl.justificationResult({
      guardianName: params.guardianName,
      studentName: params.studentName,
      date: params.date,
      decision: params.decision,
      ...(params.notes ? { notes: params.notes } : {}),
      portalUrl: webUrl,
    });
    return this.enqueue({
      to: { email: params.guardianEmail, name: params.guardianName },
      subject,
      html,
      text,
      category: MailCategory.JUSTIFICATION_RESULT,
      priority: MailPriority.HIGH,
      dedupeKey: `justif-result:${params.justificationId}`,
      schoolId: params.schoolId,
      relatedType: 'Justification',
      relatedId: params.justificationId,
    });
  }

  async sendSuspensionBroadcast(params: {
    calendarDayId: string;
    schoolId: string;
    schoolName: string;
    date: Date;
    description: string;
    type: 'HOLIDAY' | 'SUSPENDED' | 'EVENT';
    recipients: { email: string; name?: string }[];
  }) {
    const { subject, html, text } = tpl.classSuspension({
      schoolName: params.schoolName,
      date: params.date,
      description: params.description,
      type: params.type,
    });

    const inputs: EnqueueInput[] = params.recipients.map((r) => ({
      to: r,
      subject,
      html,
      text,
      category: MailCategory.CLASS_SUSPENSION,
      priority: MailPriority.HIGH,
      dedupeKey: `suspension:${params.calendarDayId}:${r.email}`,
      schoolId: params.schoolId,
      relatedType: 'CalendarDay',
      relatedId: params.calendarDayId,
    }));
    return this.enqueueBulk(inputs);
  }

  async sendSystemAlert(params: {
    to: string;
    name: string;
    subject: string;
    body: string;
    schoolId?: string;
  }) {
    const { subject, html, text } = tpl.broadcast({
      schoolName: BRAND_NAME,
      title: params.subject,
      bodyText: params.body,
      shareable: false,
    });
    return this.enqueue({
      to: { email: params.to, name: params.name },
      subject,
      html,
      text,
      category: MailCategory.SYSTEM,
      priority: MailPriority.HIGH,
      dedupeKey: `alert:${params.subject.slice(0, 40)}:${params.to}:${new Date().toISOString().split('T')[0]}`,
      ...(params.schoolId ? { schoolId: params.schoolId } : {}),
    });
  }

  webUrl(): string {
    const origins = this.config.get('cors.origins', { infer: true });
    return origins[0] ?? 'http://localhost:5173';
  }

  templates = tpl;
}

function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
