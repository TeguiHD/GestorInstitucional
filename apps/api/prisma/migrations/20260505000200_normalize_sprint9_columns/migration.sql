-- Keep the database compatible with the sprint-9 Prisma schema.
-- MariaDB supports IF NOT EXISTS for safe application across restored/baselined environments.
ALTER TABLE `schools`
  ADD COLUMN IF NOT EXISTS `rbd` VARCHAR(10) NULL;

ALTER TABLE `guardianships`
  ADD COLUMN IF NOT EXISTS `notifyAbsences` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS `notifyLate` BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS `notifyWeeklyDigest` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS `notifyUntil` DATETIME(3) NULL;
