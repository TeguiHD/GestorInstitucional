import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'director@colegio.cl' })
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.toLowerCase()?.trim())
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ description: 'Código TOTP 6 dígitos (requerido si 2FA activo)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode debe ser 6 dígitos' })
  totpCode?: string;

  @ApiPropertyOptional({ description: 'Token de dispositivo recordado (64-char hex)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceToken?: string;

  @ApiPropertyOptional({
    description: 'Si true, crea registro de dispositivo confiable por 7 días',
  })
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
