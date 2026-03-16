import { type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { NestLoggerState } from '../../types/frameworks/nestjs';
export declare class BlypNestInterceptor implements NestInterceptor {
    private readonly state;
    constructor(state: NestLoggerState);
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
}
