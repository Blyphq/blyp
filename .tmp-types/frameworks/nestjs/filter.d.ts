import type { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import type { NestLoggerState } from '../../types/frameworks/nestjs';
export declare class BlypNestExceptionFilter extends BaseExceptionFilter {
    private readonly state;
    constructor(state: NestLoggerState, httpAdapterHost: HttpAdapterHost);
    catch(exception: unknown, host: ArgumentsHost): void;
}
