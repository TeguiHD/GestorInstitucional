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
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.getResponse() : 'Error interno del servidor';

    // Never leak stack traces or internals in production
    const isDev = process.env['NODE_ENV'] !== 'production';

    if (status >= 500) {
      this.logger.error(
        { err: exception, url: request.url, method: request.method },
        'Unhandled exception',
      );
    }

    void response.status(status).send({
      statusCode: status,
      message,
      ...(isDev && exception instanceof Error ? { stack: exception.stack } : {}),
    });
  }
}
