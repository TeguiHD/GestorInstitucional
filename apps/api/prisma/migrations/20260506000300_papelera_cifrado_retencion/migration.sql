-- AttendanceJustification: cifrado en reposo + soft-delete
ALTER TABLE `attendance_justifications`
  ADD COLUMN `fileIv` VARCHAR(24) NULL AFTER `fileHash`,
  ADD COLUMN `deletedAt` DATETIME(3) NULL AFTER `createdAt`;

CREATE INDEX `attendance_justifications_deletedAt_idx`
  ON `attendance_justifications`(`deletedAt`);

-- RetentionSnapshot: resumen pre-purga MINEDUC
CREATE TABLE `retention_snapshots` (
  `id`        CHAR(36)     NOT NULL,
  `schoolId`  CHAR(36)     NOT NULL,
  `year`      INT          NOT NULL,
  `summary`   JSON         NOT NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `retention_snapshots_schoolId_year_key` (`schoolId`, `year`),
  INDEX `retention_snapshots_schoolId_idx` (`schoolId`),
  CONSTRAINT `retention_snapshots_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
