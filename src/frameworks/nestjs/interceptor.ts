import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import {
  emitHttpErrorLog,
  emitHttpRequestLog,
  isErrorStatus,
  resolveAdditionalProps,
  shouldSkipAutoLogging,
  shouldSkipErrorLogging,
  toErrorLike,
} from '../shared';
import { BLYP_NEST_LOGGER } from './constants';
import {
  attachNestRequestLogger,
  buildNestRequestLike,
  createNestLoggerContext,
  getNestStructuredLogEmitted,
  getNestRequestPath,
  getNestRequestStartTime,
  getNestResponseStatus,
  setNestRequestStartTime,
} from './helpers';
import type { NestLoggerState } from '../../types/frameworks/nestjs';

@Injectable()
export class BlypNestInterceptor implements NestInterceptor {
  constructor(
    @Inject(BLYP_NEST_LOGGER)
    private readonly state: NestLoggerState
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http'>() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const loggerContext = createNestLoggerContext({
      request,
      response,
      executionContext: context,
    });

    if (!request.blypLog) {
      attachNestRequestLogger(request, this.state.logger);
    }

    if (getNestRequestStartTime(request) === undefined) {
      setNestRequestStartTime(request, performance.now());
    }

    return next.handle().pipe(
      tap({
        complete: () => {
          const path = getNestRequestPath(request);
          const statusCode = getNestResponseStatus(response);
          const responseTime = Math.round(
            performance.now() - (getNestRequestStartTime(request) ?? performance.now())
          );
          const requestLike = buildNestRequestLike(request);
          const additionalProps = resolveAdditionalProps(this.state, loggerContext);

          if (getNestStructuredLogEmitted(request)) {
            return;
          }

          if (isErrorStatus(statusCode)) {
            if (!shouldSkipErrorLogging(this.state, path)) {
              emitHttpErrorLog(
                this.state.logger,
                this.state.level,
                requestLike,
                path,
                statusCode,
                responseTime,
                toErrorLike(undefined, statusCode),
                additionalProps
              );
            }
            return;
          }

          if (!shouldSkipAutoLogging(this.state, loggerContext, path)) {
            emitHttpRequestLog(
              this.state.logger,
              this.state.level,
              requestLike,
              path,
              statusCode,
              responseTime,
              additionalProps
            );
          }
        },
      })
    );
  }
}
