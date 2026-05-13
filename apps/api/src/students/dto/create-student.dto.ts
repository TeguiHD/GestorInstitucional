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

export class CreateStudentDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty({ example: '12345678-9', description: 'RUT sin puntos, con guion' })
  @IsString()
  @Matches(/^\d{7,8}-[\dkK]$/, { message: 'RUT inválido — formato 12345678-9' })
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
