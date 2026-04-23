import { IsArray, IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { SystemRole } from '@prisma/client';

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.toLowerCase()?.trim())
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, description: 'NIST SP 800-63B: mín 12 chars' })
  @IsString()
  @MinLength(12, { message: 'La contraseña debe tener al menos 12 caracteres' })
  @MaxLength(128)
  password!: string;

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

  @ApiProperty({ type: [String], enum: SystemRole })
  @IsArray()
  @IsEnum(SystemRole, { each: true })
  roles!: SystemRole[];

  @ApiProperty({ description: 'ID del colegio al que se vincula el usuario' })
  @IsString()
  schoolId!: string;
}
