-- CreateTable
CREATE TABLE `alert_rules` (
    `id` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `trigger` ENUM('STUDENT_BELOW_THRESHOLD', 'COURSE_BELOW_THRESHOLD', 'STUDENT_CONSECUTIVE_ABSENCES', 'TEACHER_NO_RECORD') NOT NULL,
    `threshold` DOUBLE NULL,
    `windowDays` INTEGER NOT NULL DEFAULT 30,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `notifyRoles` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `alert_rules_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `alert_rules_schoolId_trigger_key`(`schoolId`, `trigger`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alert_fired` (
    `id` CHAR(36) NOT NULL,
    `ruleId` CHAR(36) NOT NULL,
    `entityType` VARCHAR(30) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `meta` JSON NULL,
    `firedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `alert_fired_ruleId_idx`(`ruleId`),
    INDEX `alert_fired_firedAt_idx`(`firedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `alert_rules` ADD CONSTRAINT `alert_rules_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_fired` ADD CONSTRAINT `alert_fired_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `alert_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
