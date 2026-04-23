import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class BroadcastDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  schoolId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(10000)
  body!: string;

  @ApiProperty({ enum: ['ALL_GUARDIANS', 'ALL_STAFF', 'ALL'], default: 'ALL_GUARDIANS' })
  @IsEnum(['ALL_GUARDIANS', 'ALL_STAFF', 'ALL'] as const)
  audience!: 'ALL_GUARDIANS' | 'ALL_STAFF' | 'ALL';

  @ApiProperty({
    required: false,
    description: 'Incluir pedido de reenvío (default true para ampliar alcance)',
  })
  @IsOptional()
  @IsBoolean()
  shareable?: boolean;
}

export class TestMailDto {
  @ApiProperty()
  @IsEmail()
  to!: string;
}

export class CancelDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

export class ListMailsQueryDto {
  @ApiProperty({ required: false, enum: ['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] })
  @IsOptional()
  @IsEnum(['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] as const)
  status?: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category?: string;
}
