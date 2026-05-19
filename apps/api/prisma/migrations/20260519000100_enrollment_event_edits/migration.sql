-- AlterTable: add withdrawal cause + soft-void columns + updatedAt to enrollment_events
ALTER TABLE `enrollment_events`
  ADD COLUMN `withdrawalReason` ENUM(
    'CAMBIO_ESTABLECIMIENTO',
    'CAMBIO_DOMICILIO',
    'MIGRACION_INTERNACIONAL',
    'PROBLEMAS_ECONOMICOS',
    'PROBLEMAS_SALUD',
    'RETIRO_VOLUNTARIO',
    'FALLECIMIENTO',
    'EXPULSION',
    'OTRO'
  ) NULL,
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `voidedById` CHAR(36) NULL,
  ADD COLUMN `voidReason` VARCHAR(300) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- Index for filtering voided events
CREATE INDEX `enrollment_events_voidedAt_idx` ON `enrollment_events`(`voidedAt`);

-- FK to users (voidedBy)
ALTER TABLE `enrollment_events`
  ADD CONSTRAINT `enrollment_events_voidedById_fkey`
  FOREIGN KEY (`voidedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
