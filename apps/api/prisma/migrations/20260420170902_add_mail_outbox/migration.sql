-- CreateTable
CREATE TABLE `mail_outbox` (
    `id` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NULL,
    `toEmail` VARCHAR(255) NOT NULL,
    `toName` VARCHAR(200) NULL,
    `subject` VARCHAR(300) NOT NULL,
    `htmlBody` MEDIUMTEXT NOT NULL,
    `textBody` TEXT NULL,
    `category` ENUM('ABSENCE_DAILY', 'JUSTIFICATION_RESULT', 'WEEKLY_DIGEST', 'CLASS_SUSPENSION', 'BROADCAST', 'SYSTEM') NOT NULL,
    `priority` ENUM('HIGH', 'NORMAL', 'LOW') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `dedupeKey` VARCHAR(160) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(500) NULL,
    `scheduledFor` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `providerMsgId` VARCHAR(200) NULL,
    `relatedType` VARCHAR(40) NULL,
    `relatedId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mail_outbox_status_priority_scheduledFor_idx`(`status`, `priority`, `scheduledFor`),
    INDEX `mail_outbox_schoolId_category_createdAt_idx`(`schoolId`, `category`, `createdAt`),
    INDEX `mail_outbox_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `mail_outbox_dedupeKey_key`(`dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
