CREATE TABLE `school_academic_year_configs` (
  `id` CHAR(36) NOT NULL,
  `schoolId` CHAR(36) NOT NULL,
  `year` INTEGER NOT NULL,
  `firstSemesterStart` DATE NOT NULL,
  `firstSemesterEnd` DATE NOT NULL,
  `secondSemesterStart` DATE NOT NULL,
  `secondSemesterEnd` DATE NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `school_academic_year_configs_schoolId_year_key`(`schoolId`, `year`),
  INDEX `school_academic_year_configs_schoolId_idx`(`schoolId`),
  INDEX `school_academic_year_configs_year_idx`(`year`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `school_academic_year_configs`
  ADD CONSTRAINT `school_academic_year_configs_schoolId_fkey`
  FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
