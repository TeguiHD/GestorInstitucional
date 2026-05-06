import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MailCategory, MailPriority, MailStatus, SystemRole } from '@prisma/client';

import { Roles } from '../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BrevoClient } from './brevo.client.js';
import { BroadcastDto, CancelDto, ListMailsQueryDto, TestMailDto } from './dto/broadcast.dto.js';
import { MailService } from './mail.service.js';
import * as tpl from './mail.templates.js';

@ApiTags('mail')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly brevo: BrevoClient,
    private readonly prisma: PrismaService,
  ) {}

  @Get('quota')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Cuota diaria Brevo + estado cola' })
  async quota() {
    const [local, remote] = await Promise.all([
      this.mail.quotaStatus(),
      this.brevo.getAccountInfo(),
    ]);
    return { ...local, providerCredits: remote.remaining };
  }

  @Get('outbox')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR, SystemRole.UTP)
  @ApiOperation({ summary: 'Listado de cola de correo (últimos 50)' })
  async list(@Query() q: ListMailsQueryDto) {
    return this.mail.listRecent({
      ...(q.status ? { status: q.status as MailStatus } : {}),
      ...(q.category ? { category: q.category as MailCategory } : {}),
      limit: 100,
    });
  }

  @Post('test')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Envío de prueba (encola y será drenado por cron en <5min)' })
  async test(@Body() dto: TestMailDto) {
    const { subject, html, text } = tpl.broadcast({
      schoolName: 'CSSP',
      title: 'Correo de prueba',
      bodyText: 'Si recibes este mensaje, la configuración Brevo + cola funciona correctamente.',
    });
    return this.mail.enqueue({
      to: { email: dto.to },
      subject,
      html,
      text,
      category: MailCategory.SYSTEM,
      priority: MailPriority.HIGH,
    });
  }

  @Post('broadcast')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({
    summary: 'Envío masivo a apoderados, staff o ambos (respeta cuota diaria automáticamente)',
  })
  async broadcast(@Body() dto: BroadcastDto) {
    const school = await this.prisma.school.findUnique({
      where: { id: dto.schoolId },
      select: { id: true, name: true },
    });
    if (!school) throw new BadRequestException('Colegio no encontrado');

    const recipients = await this.resolveAudience(dto.schoolId, dto.audience);
    if (recipients.length === 0) throw new BadRequestException('Sin destinatarios');

    const { subject, html, text } = tpl.broadcast({
      schoolName: school.name,
      title: dto.title,
      bodyText: dto.body,
      shareable: dto.shareable !== false,
    });

    const dedupePrefix = `broadcast:${Date.now()}`;
    const result = await this.mail.enqueueBulk(
      recipients.map((r) => ({
        to: { email: r.email, name: r.name },
        subject,
        html,
        text,
        category: MailCategory.BROADCAST,
        priority: MailPriority.NORMAL,
        dedupeKey: `${dedupePrefix}:${r.email}`,
        schoolId: dto.schoolId,
      })),
    );

    return { ...result, totalRecipients: recipients.length };
  }

  @Post('cancel')
  @Roles(SystemRole.SUPER_ADMIN, SystemRole.DIRECTOR)
  @ApiOperation({ summary: 'Cancelar correos pendientes por id' })
  async cancel(@Body() dto: CancelDto) {
    const cancelled = await this.mail.cancelPending(dto.ids);
    return { cancelled };
  }

  private async resolveAudience(schoolId: string, audience: 'ALL_GUARDIANS' | 'ALL_STAFF' | 'ALL') {
    const out: { email: string; name: string }[] = [];
    const seen = new Set<string>();

    if (audience === 'ALL_GUARDIANS' || audience === 'ALL') {
      const guardians = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          schoolRoles: { some: { schoolId, role: 'APODERADO' } },
          guardianships: { some: { student: { schoolId, active: true } } },
        },
        select: { email: true, firstName: true, lastName: true },
      });
      for (const g of guardians) {
        const key = g.email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ email: g.email, name: `${g.firstName} ${g.lastName}` });
      }
    }
    if (audience === 'ALL_STAFF' || audience === 'ALL') {
      const staff = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          schoolRoles: {
            some: {
              schoolId,
              role: { in: ['DIRECTOR', 'UTP', 'INSPECTORIA', 'PROFESOR', 'SUPER_ADMIN'] },
            },
          },
        },
        select: { email: true, firstName: true, lastName: true },
      });
      for (const s of staff) {
        const key = s.email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ email: s.email, name: `${s.firstName} ${s.lastName}` });
      }
    }
    return out;
  }
}
