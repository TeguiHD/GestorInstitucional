-- CreateTable
CREATE TABLE `school_calendar_days` (
    `id` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `type` ENUM('HOLIDAY', 'SUSPENDED', 'EVENT') NOT NULL,
    `description` VARCHAR(200) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `school_calendar_days_schoolId_date_idx`(`schoolId`, `date`),
    UNIQUE INDEX `school_calendar_days_schoolId_date_key`(`schoolId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `school_calendar_days` ADD CONSTRAINT `school_calendar_days_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
