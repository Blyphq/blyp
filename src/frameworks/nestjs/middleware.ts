import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import {
  BLYP_TRACE_HEADER,
  createRequestTraceId,
  createRequestScopedLogger,
  handleClientLogIngestion,
  enterRequestContext,
  resolveAdditionalProps,
  setActiveRequestTraceId,
} from '../shared';
import { BLYP_NEST_LOGGER } from './constants';
import {
  attachNestRequestLogger,
  attachNestRequestTraceId,
  buildNestRequestLike,
  createNestLoggerContext,
  getNestRequestMethod,
  getNestRequestPath,
  readNestRequestBody,
  setNestResponseHeaders,
  sendNestStatusResponse,
  setNestStructuredLogEmitted,
  setNestRequestStartTime,
} from './helpers';
import type { NestLoggerState } from '../../types/frameworks/nestjs';

@Injectable()
export class BlypNestMiddleware implements NestMiddleware {
  constructor(
    @Inject(BLYP_NEST_LOGGER)
    private readonly state: NestLoggerState
  ) {}

  use(
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ): void {
    enterRequestContext();
    const traceId = createRequestTraceId();
    setActiveRequestTraceId(traceId);
    setNestStructuredLogEmitted(request, false);
    attachNestRequestTraceId(request, traceId);
    setNestResponseHeaders(response, {
      [BLYP_TRACE_HEADER]: traceId,
    });
    attachNestRequestLogger(
      request,
      createRequestScopedLogger(this.state.logger, {
        resolveStructuredFields: () => {
          const loggerContext = createNestLoggerContext({
            request,
            response,
          });

          return {
            method: buildNestRequestLike(request).method,
            path: getNestRequestPath(request),
            ...resolveAdditionalProps(this.state, loggerContext),
          };
        },
        onStructuredEmit: () => {
          setNestStructuredLogEmitted(request, true);
        },
      })
    );
    setNestRequestStartTime(request, performance.now());

    const path = getNestRequestPath(request);
    const method = getNestRequestMethod(request).toUpperCase();

    if (
      this.state.resolvedClientLogging &&
      method === 'POST' &&
      path === this.state.ingestionPath
    ) {
      void this.handleClientLogRequest(request, response, next);
      return;
    }

    next();
  }

  private async handleClientLogRequest(
    request: unknown,
    response: unknown,
    next: (error?: unknown) => void
  ): Promise<void> {
    try {
      const body = await readNestRequestBody(request);
      const result = await handleClientLogIngestion({
        config: this.state,
        ctx: createNestLoggerContext({
          request,
          response,
        }),
        request: buildNestRequestLike(request),
        body,
        deliveryPath: this.state.ingestionPath,
      });

      if (result.headers) {
        setNestResponseHeaders(response, result.headers);
      }
      sendNestStatusResponse(response, result.status);
    } catch (error) {
      next(error);
    }
  }
}
