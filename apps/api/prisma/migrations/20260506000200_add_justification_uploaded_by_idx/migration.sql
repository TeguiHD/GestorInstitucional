-- Add composite index on attendance_justifications(uploadedById, createdAt)
-- for efficient "justificaciones subidas por mí" queries
CREATE INDEX `attendance_justifications_uploadedById_createdAt_idx`
  ON `attendance_justifications`(`uploadedById`, `createdAt`);
