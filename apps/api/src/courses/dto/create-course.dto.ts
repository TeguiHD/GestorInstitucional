import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCourseDto {
  @ApiProperty()
  @IsUUID()
  schoolId!: string;

  @ApiProperty({ example: '1A' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  code!: string;

  @ApiProperty({ example: '1° Básico A' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'Básica' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  level!: string;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  headTeacherId?: string;
}
