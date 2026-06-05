import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateBackupConfigDto {
  @ApiProperty({ example: 'nico@gmail.com,admin@colegio.cl' })
  @IsString()
  emails!: string;

  @ApiProperty({ example: '23:00' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'El formato de hora debe ser HH:MM (24 horas)',
  })
  time!: string;

  @ApiProperty({ example: 'ContrasenaSegura123', required: false })
  @IsString()
  @IsOptional()
  encryptPassword?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  active!: boolean;
}
