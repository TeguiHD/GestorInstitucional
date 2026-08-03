import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';

import { AttendanceDayDto } from './record-attendance.dto.js';

export class RecordAttendanceBatchDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiProperty({
    type: [AttendanceDayDto],
    description: 'Días a guardar. Se validan todos antes de escribir ninguno.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  // Un mes lectivo no pasa de 31 días. El tope acota el tamaño de la
  // transacción: 31 días × ~40 alumnos son unas 1.240 escrituras.
  @ArrayMaxSize(31)
  @Type(() => AttendanceDayDto)
  days!: AttendanceDayDto[];
}
