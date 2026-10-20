-- Exención de verificación en dos pasos administrada por SUPER_ADMIN: temporal
-- (mfaExemptUntil) o indefinida (mfaExemptUntil NULL). Solo agrega columnas.
ALTER TABLE `users`
  ADD COLUMN `mfaExemptAt` DATETIME(3) NULL,
  ADD COLUMN `mfaExemptUntil` DATETIME(3) NULL,
  ADD COLUMN `mfaExemptById` CHAR(36) NULL,
  ADD COLUMN `mfaExemptReason` VARCHAR(200) NULL;
