-- AddTable: notifications
CREATE TABLE `notifications` (
  `id`        CHAR(36)      NOT NULL,
  `userId`    CHAR(36)      NOT NULL,
  `type`      VARCHAR(40)   NOT NULL,
  `title`     VARCHAR(200)  NOT NULL,
  `body`      VARCHAR(500)  NOT NULL,
  `link`      VARCHAR(500)  NULL,
  `readAt`    DATETIME(3)   NULL,
  `createdAt` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `notifications_userId_readAt_idx`    (`userId`, `readAt`),
  INDEX `notifications_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddTable: guardian_contacts
CREATE TABLE `guardian_contacts` (
  `id`         CHAR(36)     NOT NULL,
  `userId`     CHAR(36)     NOT NULL,
  `type`       VARCHAR(20)  NOT NULL,
  `phone`      VARCHAR(30)  NOT NULL,
  `label`      VARCHAR(80)  NULL,
  `isWhatsApp` BOOLEAN      NOT NULL DEFAULT FALSE,
  `priority`   INT          NOT NULL DEFAULT 0,
  `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `guardian_contacts_userId_idx` (`userId`),
  CONSTRAINT `guardian_contacts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddTable: subjects
CREATE TABLE `subjects` (
  `id`           CHAR(36)     NOT NULL,
  `schoolId`     CHAR(36)     NOT NULL,
  `courseId`     CHAR(36)     NOT NULL,
  `name`         VARCHAR(120) NOT NULL,
  `code`         VARCHAR(20)  NOT NULL,
  `teacherId`    CHAR(36)     NULL,
  `semester`     INT          NOT NULL DEFAULT 0,
  `hoursPerWeek` INT          NOT NULL DEFAULT 4,
  `active`       BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `subjects_courseId_code_key` (`courseId`, `code`),
  INDEX `subjects_courseId_idx`  (`courseId`),
  INDEX `subjects_schoolId_idx`  (`schoolId`),
  CONSTRAINT `subjects_schoolId_fkey`  FOREIGN KEY (`schoolId`)  REFERENCES `schools` (`id`)  ON DELETE CASCADE,
  CONSTRAINT `subjects_courseId_fkey`  FOREIGN KEY (`courseId`)  REFERENCES `courses` (`id`)  ON DELETE CASCADE,
  CONSTRAINT `subjects_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `users`   (`id`)  ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddTable: grades
CREATE TABLE `grades` (
  `id`           CHAR(36)     NOT NULL,
  `studentId`    CHAR(36)     NOT NULL,
  `subjectId`    CHAR(36)     NOT NULL,
  `period`       ENUM('P1','P2','E1','P3','P4','E2','NF') NOT NULL,
  `value`        DECIMAL(4,1) NOT NULL,
  `comment`      VARCHAR(200) NULL,
  `recordedById` CHAR(36)     NOT NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `grades_studentId_subjectId_period_key` (`studentId`, `subjectId`, `period`),
  INDEX `grades_subjectId_idx`  (`subjectId`),
  INDEX `grades_studentId_idx`  (`studentId`),
  CONSTRAINT `grades_studentId_fkey`    FOREIGN KEY (`studentId`)    REFERENCES `students` (`id`) ON DELETE CASCADE,
  CONSTRAINT `grades_subjectId_fkey`    FOREIGN KEY (`subjectId`)    REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `grades_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `users`    (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddTable: schedule_slots
CREATE TABLE `schedule_slots` (
  `id`          CHAR(36)    NOT NULL,
  `courseId`    CHAR(36)    NOT NULL,
  `subjectId`   CHAR(36)    NOT NULL,
  `teacherId`   CHAR(36)    NOT NULL,
  `dayOfWeek`   INT         NOT NULL,
  `slotNumber`  INT         NOT NULL,
  `startTime`   VARCHAR(5)  NOT NULL,
  `endTime`     VARCHAR(5)  NOT NULL,
  `roomNumber`  VARCHAR(20) NULL,
  `year`        INT         NOT NULL,
  `semester`    INT         NOT NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `schedule_slots_courseId_dayOfWeek_slotNumber_year_semester_key`
    (`courseId`, `dayOfWeek`, `slotNumber`, `year`, `semester`),
  INDEX `schedule_slots_courseId_idx`  (`courseId`),
  INDEX `schedule_slots_teacherId_idx` (`teacherId`),
  CONSTRAINT `schedule_slots_courseId_fkey`  FOREIGN KEY (`courseId`)  REFERENCES `courses`  (`id`) ON DELETE CASCADE,
  CONSTRAINT `schedule_slots_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `schedule_slots_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `users`    (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddTable: enrollment_events
CREATE TABLE `enrollment_events` (
  `id`                    CHAR(36)     NOT NULL,
  `studentId`             CHAR(36)     NOT NULL,
  `courseId`              CHAR(36)     NOT NULL,
  `schoolId`              CHAR(36)     NOT NULL,
  `status`                ENUM('ACTIVE','WITHDRAWN','TRANSFERRED_OUT','TRANSFERRED_IN','RE_ENROLLED','GRADUATED') NOT NULL,
  `effectiveDate`         DATE         NOT NULL,
  `reason`                VARCHAR(200) NULL,
  `transferredToCourseId` CHAR(36)     NULL,
  `transferredToSchool`   VARCHAR(200) NULL,
  `externalGrades`        JSON         NULL,
  `recordedById`          CHAR(36)     NOT NULL,
  `createdAt`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `enrollment_events_studentId_idx`     (`studentId`),
  INDEX `enrollment_events_courseId_idx`      (`courseId`),
  INDEX `enrollment_events_schoolId_idx`      (`schoolId`),
  INDEX `enrollment_events_effectiveDate_idx` (`effectiveDate`),
  CONSTRAINT `enrollment_events_studentId_fkey`    FOREIGN KEY (`studentId`)   REFERENCES `students` (`id`) ON DELETE CASCADE,
  CONSTRAINT `enrollment_events_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `users`   (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
