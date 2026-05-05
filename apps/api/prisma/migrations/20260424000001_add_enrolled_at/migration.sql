-- AlterTable
ALTER TABLE `students` ADD COLUMN `enrolled_at` DATETIME(3) NOT NULL DEFAULT NOW();
