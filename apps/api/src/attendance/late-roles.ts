import { SystemRole } from '@prisma/client';

import type { JwtPayload } from '../common/decorators/current-user.decorator.js';

/** Roles que resuelven atrasos pendientes (los mismos que revisan justificaciones). */
export const LATE_RESOLVER_ROLES: readonly string[] = [
  SystemRole.SUPER_ADMIN,
  SystemRole.DIRECTOR,
  SystemRole.UTP,
  SystemRole.INSPECTORIA,
];

export function canResolveLate(user: Pick<JwtPayload, 'roles'>): boolean {
  return user.roles.some((role) => LATE_RESOLVER_ROLES.includes(role));
}
