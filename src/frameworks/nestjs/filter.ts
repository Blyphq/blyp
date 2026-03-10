import {
  Catch,
  HttpException,
  Inject,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import {
  emitHttpErrorLog,
  resolveAdditionalProps,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';
import { BLYP_NEST_LOGGER } from './constants';
import {
  buildNestRequestLike,
  createNestLoggerContext,
  getNestRequestPath,
  getNestRequestStartTime,
} from './helpers';
import type { NestLoggerState } from './logger';

@Catch()
export class BlypNestExceptionFilter extends BaseExceptionFilter {
  constructor(
    @Inject(BLYP_NEST_LOGGER)
    private readonly state: NestLoggerState,
    httpAdapterHost: HttpAdapterHost
  ) {
    super(httpAdapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<'http'>() === 'http') {
      const http = host.switchToHttp();
      const request = http.getRequest();
      const response = http.getResponse();
      const loggerContext = createNestLoggerContext({
        request,
        response,
        error: exception,
      });
      const path = getNestRequestPath(request);

      if (!shouldSkipErrorLogging(this.state, path)) {
        const statusCode = exception instanceof HttpException
          ? exception.getStatus()
          : 500;
        const responseTime = Math.round(
          performance.now() - (getNestRequestStartTime(request) ?? performance.now())
        );

        emitHttpErrorLog(
          this.state.logger,
          this.state.level,
          buildNestRequestLike(request),
          path,
          statusCode,
          responseTime,
          toErrorLike(exception, statusCode),
          resolveAdditionalProps(this.state, loggerContext)
        );
      }
    }

    super.catch(exception, host);
  }
}
