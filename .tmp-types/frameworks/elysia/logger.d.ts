import { Elysia } from 'elysia';
import type { ElysiaLoggerConfig } from '../../types/frameworks/elysia';
export declare function createElysiaLogger(config?: ElysiaLoggerConfig): Elysia<"", {
    decorator: {
        log: import("../..").BlypLogger;
    };
    store: {};
    derive: {};
    resolve: {};
}, {
    typebox: {};
    error: {};
}, {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
}, {}, {
    derive: {
        readonly startTime: number;
        readonly log: import("../..").BlypLogger;
    };
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}>;
