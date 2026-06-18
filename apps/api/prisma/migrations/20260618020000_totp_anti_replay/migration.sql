-- Anti-replay TOTP: guarda el último timestep consumido para rechazar reuso de un código.
ALTER TABLE `totp_secrets` ADD COLUMN `lastTotpStep` INT NULL;
