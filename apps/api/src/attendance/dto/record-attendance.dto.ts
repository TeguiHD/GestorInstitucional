import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceStatus } from '@prisma/client';

class AttendanceEntryDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Minutos de atraso (solo si status=LATE)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  lateMinutes?: number;
}

export class RecordAttendanceDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty({ example: '2026-04-19', description: 'YYYY-MM-DD' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe ser YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ type: [AttendanceEntryDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}
