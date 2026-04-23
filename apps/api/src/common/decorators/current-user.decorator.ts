import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export type JwtPayload = {
  sub: string;
  email: string;
  schoolId: string;
  roles: string[];
  totpVerified: boolean;
  totpSetupRequired?: boolean;
  iat: number;
  exp: number;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    return request.user;
  },
);
