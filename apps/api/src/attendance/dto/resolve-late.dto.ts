import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

export class ResolveLateDto {
  @ApiProperty({ type: [String], description: 'IDs de registros con atraso pendiente' })
  @IsArray()
  @ArrayMinSize(1)
  // Tope por lote: una página de la bandeja tiene 50; 200 deja margen sin
  // permitir transacciones desmedidas.
  @ArrayMaxSize(200)
  @IsString({ each: true })
  recordIds!: string[];

  @ApiProperty({ enum: ['PRESENT', 'ABSENT'] })
  @IsIn(['PRESENT', 'ABSENT'])
  status!: 'PRESENT' | 'ABSENT';
}
