import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { normalizeRut } from '../rut.js';

export class ImportStudentRow {
  @ApiProperty({ example: '12345678-9', description: 'RUT chileno o IPE MINEDUC' })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeRut(value) : value))
  @IsString()
  @Matches(/^\d{7,9}-[\dkK]$/, { message: 'RUT o IPE inválido' })
  rut!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
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

  @ApiPropertyOptional({
    description: 'Fecha real de ingreso al curso (YYYY-MM-DD). Si se omite usa hoy.',
  })
  @IsOptional()
  @IsDateString()
  enrolledAt?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  enrollmentNumber!: number;
}

export class ImportStudentsDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty({ type: [ImportStudentRow] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportStudentRow)
  rows!: ImportStudentRow[];
}
