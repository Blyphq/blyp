import { type NestMiddleware } from '@nestjs/common';
import type { NestLoggerState } from '../../types/frameworks/nestjs';
export declare class BlypNestMiddleware implements NestMiddleware {
    private readonly state;
    constructor(state: NestLoggerState);
    use(request: unknown, response: unknown, next: (error?: unknown) => void): void;
    private handleClientLogRequest;
}
