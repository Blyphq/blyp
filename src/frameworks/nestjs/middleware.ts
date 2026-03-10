import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import {
  handleClientLogIngestion,
} from '../shared';
import { BLYP_NEST_LOGGER } from './constants';
import {
  attachNestRequestLogger,
  buildNestRequestLike,
  createNestLoggerContext,
  getNestRequestMethod,
  getNestRequestPath,
  readNestRequestBody,
  sendNestStatusResponse,
  setNestRequestStartTime,
} from './helpers';
import type { NestLoggerState } from './logger';

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
    attachNestRequestLogger(request, this.state.logger);
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

      sendNestStatusResponse(response, result.status);
    } catch (error) {
      next(error);
    }
  }
}
