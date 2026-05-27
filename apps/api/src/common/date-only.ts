import { BadRequestException } from '@nestjs/common';

function assertCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException('Fecha inválida');
  }
  return date;
}

export function parseDateOnlyUtc(value?: string): Date {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return assertCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const cl = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (cl) {
    return assertCalendarDate(Number(cl[3]), Number(cl[2]), Number(cl[1]));
  }

  throw new BadRequestException('Fecha inválida');
}
