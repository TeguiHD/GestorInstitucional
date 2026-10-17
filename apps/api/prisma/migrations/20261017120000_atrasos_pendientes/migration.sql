-- Atrasos pendientes de resolución (spec 2026-10-17-atrasos-pendientes-design.md).
--
-- Desde ahora status = LATE significa "atraso pendiente": no cuenta en el % de
-- asistencia hasta que Inspectoría lo resuelva a PRESENT o ABSENT. La marca
-- wasLate conserva el hecho de que hubo atraso aunque cambie el estado.
ALTER TABLE `attendance_records` ADD COLUMN `wasLate` BOOLEAN NOT NULL DEFAULT false;

-- Los atrasos ya registrados se tomaron con la regla anterior (contaban como
-- presentes). Se convierten a PRESENT con marca de atraso: los porcentajes ya
-- informados no cambian, el conteo de atrasos se conserva e Inspectoría no
-- recibe una bandeja con cientos de casos antiguos.
--
-- La lista exacta de registros convertidos queda en la auditoría (reversible).
SET @converted_ids = (
  SELECT JSON_ARRAYAGG(`id`) FROM `attendance_records` WHERE `status` = 'LATE'
);
SET @converted_count = (SELECT COUNT(*) FROM `attendance_records` WHERE `status` = 'LATE');

UPDATE `attendance_records` SET `wasLate` = true, `status` = 'PRESENT' WHERE `status` = 'LATE';

-- Evento de auditoría encadenado con el mismo hash que AuditService.log():
-- sha256(id|userId|action|entity|entityId|createdAt ISO|prevHash).
SET @audit_id = UUID();
SET @audit_at = UTC_TIMESTAMP(3);
SET @audit_iso = CONCAT(DATE_FORMAT(@audit_at, '%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND(@audit_at) / 1000), 3, '0'), 'Z');
SET @prev_hash = (SELECT `hash` FROM `audit_events` ORDER BY `createdAt` DESC LIMIT 1);

INSERT INTO `audit_events` (`id`, `userId`, `action`, `entity`, `entityId`, `meta`, `ip`, `userAgent`, `prevHash`, `hash`, `createdAt`)
SELECT
  @audit_id, NULL, 'UPDATE', 'AttendanceRecord', NULL,
  JSON_OBJECT(
    'migration', '20261017120000_atrasos_pendientes',
    'rule', 'Atrasos registrados antes de la regla de atrasos pendientes: LATE -> PRESENT con wasLate = true',
    'convertedCount', @converted_count,
    'convertedIds', JSON_EXTRACT(COALESCE(@converted_ids, '[]'), '$')
  ),
  NULL, NULL, @prev_hash,
  SHA2(CONCAT_WS('|', @audit_id, '', 'UPDATE', 'AttendanceRecord', '', @audit_iso, COALESCE(@prev_hash, '')), 256),
  @audit_at
WHERE @converted_count > 0;
