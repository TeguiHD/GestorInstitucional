import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

export class ImportStudentRow {
  @ApiProperty({ example: '12345678-9' })
  @IsString()
  @Matches(/^\d{7,8}-[\dkK]$/, { message: 'RUT inválido' })
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
