import type { MiddlewareConsumer, DynamicModule, NestModule } from '@nestjs/common';
export declare class BlypModule implements NestModule {
    static forRoot(): DynamicModule;
    configure(consumer: MiddlewareConsumer): void;
}
