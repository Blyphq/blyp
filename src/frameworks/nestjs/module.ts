import {
  Global,
  Module,
  RequestMethod,
} from '@nestjs/common';
import type { MiddlewareConsumer, DynamicModule, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { BLYP_NEST_LOGGER } from './constants';
import { BlypNestExceptionFilter } from './filter';
import { BlypNestInterceptor } from './interceptor';
import { getNestLoggerStateOrThrow } from './logger';
import { BlypNestMiddleware } from './middleware';

@Global()
@Module({})
export class BlypModule implements NestModule {
  static forRoot(): DynamicModule {
    return {
      global: true,
      module: BlypModule,
      providers: [
        BlypNestMiddleware,
        {
          provide: BLYP_NEST_LOGGER,
          useFactory: () => getNestLoggerStateOrThrow(),
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: BlypNestInterceptor,
        },
        {
          provide: APP_FILTER,
          useClass: BlypNestExceptionFilter,
        },
      ],
      exports: [BLYP_NEST_LOGGER],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(BlypNestMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
