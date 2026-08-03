import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

import { normalizeRut } from '../rut.js';

export class CreateStudentDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty({
    example: '12345678-9',
    description: 'RUT chileno (7-8 dígitos) o IPE MINEDUC (9 dígitos). Se normaliza el guion.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeRut(value) : value))
  @IsString()
  @Matches(/^\d{7,9}-[\dkK]$/, {
    message: 'RUT o IPE inválido — formatos 12345678-9 (RUT) o 100448352-5 (IPE)',
  })
  rut!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondLastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  enrollmentNumber?: number;

  @ApiPropertyOptional({
    description: 'Si viene de otro colegio, nombre del establecimiento origen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  transferOriginSchool?: string;

  @ApiPropertyOptional({ description: 'Fecha efectiva de matrícula YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
