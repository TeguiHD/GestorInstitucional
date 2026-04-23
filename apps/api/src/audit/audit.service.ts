import * as crypto from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

type LogInput = {
  userId?: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string | undefined;
  ua?: string | undefined;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: LogInput): Promise<void> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Get last hash for chain (best-effort — non-blocking read)
    let prevHash: string | null = null;
    try {
      const last = await this.prisma.auditEvent.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { hash: true },
      });
      prevHash = last?.hash ?? null;
    } catch {
      // Degraded mode — chain broken but event still recorded
    }

    const hashPayload = [
      id,
      input.userId ?? '',
      input.action,
      input.entity ?? '',
      input.entityId ?? '',
      createdAt,
      prevHash ?? '',
    ].join('|');

    const hash = crypto.createHash('sha256').update(hashPayload).digest('hex');

    await this.prisma.auditEvent.create({
      data: {
        id,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        meta: (input.meta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ip: input.ip ?? null,
        userAgent: input.ua ?? null,
        prevHash,
        hash,
      },
    });
  }

  async list(opts: {
    entity?: string;
    entityId?: string;
    userId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (opts.entity) where['entity'] = opts.entity;
    if (opts.entityId) where['entityId'] = opts.entityId;
    if (opts.userId) where['userId'] = opts.userId;
    if (opts.action) where['action'] = opts.action;

    const [total, events] = await Promise.all([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit ?? 50,
        skip: opts.offset ?? 0,
        include: { user: { select: { email: true, firstName: true, lastName: true } } },
      }),
    ]);
    return { total, events };
  }
}
