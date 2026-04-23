-- CreateTable
CREATE TABLE `schools` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `address` VARCHAR(300) NULL,
    `phone` VARCHAR(30) NULL,
    `logoUrl` VARCHAR(500) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `schools_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(500) NOT NULL,
    `firstName` VARCHAR(80) NOT NULL,
    `lastName` VARCHAR(80) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_school_roles` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'DIRECTOR', 'UTP', 'PROFESOR', 'APODERADO') NOT NULL,

    INDEX `user_school_roles_userId_idx`(`userId`),
    INDEX `user_school_roles_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `user_school_roles_userId_schoolId_role_key`(`userId`, `schoolId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `school_permissions` (
    `id` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'DIRECTOR', 'UTP', 'PROFESOR', 'APODERADO') NOT NULL,
    `permission` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `school_permissions_schoolId_role_permission_key`(`schoolId`, `role`, `permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `totp_secrets` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `secret` VARCHAR(300) NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `backupCodes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,

    UNIQUE INDEX `totp_secrets_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `family` CHAR(36) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `userAgent` VARCHAR(400) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_family_idx`(`family`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courses` (
    `id` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `level` VARCHAR(40) NOT NULL,
    `year` INTEGER NOT NULL,
    `headTeacherId` CHAR(36) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `courses_schoolId_idx`(`schoolId`),
    INDEX `courses_year_idx`(`year`),
    UNIQUE INDEX `courses_schoolId_code_year_key`(`schoolId`, `code`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_teachers` (
    `id` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `isHead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `course_teachers_userId_idx`(`userId`),
    UNIQUE INDEX `course_teachers_courseId_userId_key`(`courseId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` CHAR(36) NOT NULL,
    `schoolId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `rut` VARCHAR(12) NOT NULL,
    `firstName` VARCHAR(80) NOT NULL,
    `lastName` VARCHAR(80) NOT NULL,
    `secondLastName` VARCHAR(80) NULL,
    `birthDate` DATE NULL,
    `enrollmentNumber` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `withdrawnAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `students_courseId_idx`(`courseId`),
    INDEX `students_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `students_schoolId_rut_key`(`schoolId`, `rut`),
    UNIQUE INDEX `students_courseId_enrollmentNumber_key`(`courseId`, `enrollmentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardianships` (
    `id` CHAR(36) NOT NULL,
    `guardianId` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `relation` VARCHAR(40) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `guardianships_studentId_idx`(`studentId`),
    UNIQUE INDEX `guardianships_guardianId_studentId_key`(`guardianId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_records` (
    `id` CHAR(36) NOT NULL,
    `studentId` CHAR(36) NOT NULL,
    `courseId` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'JUSTIFIED', 'WITHDRAWN') NOT NULL,
    `note` VARCHAR(500) NULL,
    `lateMinutes` INTEGER NULL,
    `recordedById` CHAR(36) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_records_courseId_date_idx`(`courseId`, `date`),
    INDEX `attendance_records_studentId_idx`(`studentId`),
    INDEX `attendance_records_date_idx`(`date`),
    UNIQUE INDEX `attendance_records_studentId_date_key`(`studentId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'TOTP_ENABLE', 'TOTP_DISABLE', 'TOKEN_REVOKE', 'EXPORT', 'PERMISSION_CHANGE') NOT NULL,
    `entity` VARCHAR(60) NULL,
    `entityId` VARCHAR(36) NULL,
    `meta` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `userAgent` VARCHAR(400) NULL,
    `prevHash` CHAR(64) NULL,
    `hash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_events_userId_idx`(`userId`),
    INDEX `audit_events_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `audit_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_school_roles` ADD CONSTRAINT `user_school_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_school_roles` ADD CONSTRAINT `user_school_roles_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `school_permissions` ADD CONSTRAINT `school_permissions_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `totp_secrets` ADD CONSTRAINT `totp_secrets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `courses` ADD CONSTRAINT `courses_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_teachers` ADD CONSTRAINT `course_teachers_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_teachers` ADD CONSTRAINT `course_teachers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `schools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardianships` ADD CONSTRAINT `guardianships_guardianId_fkey` FOREIGN KEY (`guardianId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardianships` ADD CONSTRAINT `guardianships_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
