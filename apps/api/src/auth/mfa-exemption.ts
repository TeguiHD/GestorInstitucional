/**
 * Exención de verificación en dos pasos dada por un SUPER_ADMIN.
 *
 * Mientras está vigente, el login no pide código ni obliga a configurar el
 * autenticador. No borra nada: al vencer (o al revocarla) el autenticador que
 * el usuario tenía vuelve a pedirse tal cual.
 */
export type MfaExemptionFields = {
  mfaExemptAt: Date | null;
  mfaExemptUntil: Date | null;
};

export function isMfaExempt(user: MfaExemptionFields, now: Date = new Date()): boolean {
  if (!user.mfaExemptAt) return false;
  return user.mfaExemptUntil === null || user.mfaExemptUntil > now;
}
