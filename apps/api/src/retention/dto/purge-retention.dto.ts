import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Min, ValidateNested } from 'class-validator';

/** Frase literal que el operador debe escribir para ejecutar la purga. */
export const PURGE_CONFIRMATION = 'PURGAR DEFINITIVAMENTE';

/**
 * Conteos que el operador vio en el preview.
 *
 * Se exigen para que la purga no pueda ejecutarse a ciegas: si entre el preview
 * y la ejecución cambió algo, los números no cuadran y la operación se aborta.
 */
export class PurgeExpectedCountsDto {
  @ApiProperty() @IsInt() @Min(0) attendance!: number;
  @ApiProperty() @IsInt() @Min(0) justifications!: number;
  @ApiProperty() @IsInt() @Min(0) audit!: number;
  @ApiProperty() @IsInt() @Min(0) mail!: number;
  @ApiProperty() @IsInt() @Min(0) alerts!: number;
  @ApiProperty() @IsInt() @Min(0) tokens!: number;
}

export class PurgeRetentionDto {
  @ApiProperty({
    example: PURGE_CONFIRMATION,
    description: 'Debe ser exactamente esta frase, en mayúsculas.',
  })
  @IsString()
  @Matches(new RegExp(`^${PURGE_CONFIRMATION}$`), {
    message: `Para ejecutar la purga hay que escribir exactamente: ${PURGE_CONFIRMATION}`,
  })
  confirm!: string;

  @ApiProperty({
    type: PurgeExpectedCountsDto,
    description: 'Los conteos tal como los devolvió GET /admin/retention/preview.',
  })
  @ValidateNested()
  @Type(() => PurgeExpectedCountsDto)
  expected!: PurgeExpectedCountsDto;
}
