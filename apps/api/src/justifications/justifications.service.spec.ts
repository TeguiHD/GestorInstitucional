import { Readable } from 'node:stream';

import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JustificationsService } from './justifications.service.js';

type RecordStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'JUSTIFIED' | 'WITHDRAWN';

function makeService(record: { status: RecordStatus; justifications: Array<{ id: string }> }) {
  const prisma = {
    attendanceRecord: {
      findUnique: vi.fn().mockResolvedValue({
        ...record,
        student: {
          schoolId: 'school-1',
          courseId: 'course-1',
          guardianships: [{ guardianId: 'guardian-1' }],
        },
      }),
    },
  };
  const audit = { log: vi.fn() };
  const mail = { sendJustificationResult: vi.fn() };

  return new JustificationsService(prisma as never, audit as never, mail as never);
}

function uploadInput() {
  return {
    recordId: 'record-1',
    uploadedById: 'guardian-1',
    actor: {
      sub: 'guardian-1',
      email: 'apoderado@example.cl',
      schoolId: 'school-1',
      roles: ['APODERADO'],
      totpVerified: true,
      iat: 1,
      exp: 2,
    },
    reason: 'Control médico',
    file: {
      filename: 'certificado.pdf',
      mimetype: 'application/pdf',
      stream: Readable.from(['test']),
    },
  };
}

describe('JustificationsService.upload', () => {
  it('rechaza certificados sobre registros presentes', async () => {
    const service = makeService({ status: 'PRESENT', justifications: [] });

    await expect(service.upload(uploadInput())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza duplicar una justificación activa del mismo registro', async () => {
    const service = makeService({ status: 'ABSENT', justifications: [{ id: 'just-1' }] });

    await expect(service.upload(uploadInput())).rejects.toBeInstanceOf(ConflictException);
  });
});
