-- Normalize Student.enrolledAt column name after sprint-9 introduced it as enrolled_at.
-- Fresh databases apply add_enrolled_at first, then this migration.
ALTER TABLE `students`
  CHANGE COLUMN `enrolled_at` `enrolledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
