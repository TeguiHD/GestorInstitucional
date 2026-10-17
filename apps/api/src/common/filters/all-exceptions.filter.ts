import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // getResponse() devuelve un objeto ({ message, error, statusCode, ...extras }) salvo
    // que la excepción se cree con un string crudo. Se aplana para que `message` sea
    // siempre texto y los extras (remainingAttempts, conflictingDates) queden arriba.
    const response =
      exception instanceof HttpException ? exception.getResponse() : 'Error interno del servidor';
    const body = typeof response === 'string' ? { message: response } : response;

    // Never leak stack traces or internals in production
    const isDev = process.env['NODE_ENV'] !== 'production';

    if (status >= 500) {
      this.logger.error(
        { err: exception, url: request.url, method: request.method },
        'Unhandled exception',
      );
    }

    void reply.status(status).send({
      ...body,
      statusCode: status,
      ...(isDev && exception instanceof Error ? { stack: exception.stack } : {}),
    });
  }
}
