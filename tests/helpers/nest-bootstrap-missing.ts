import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BlypModule } from '../../src/frameworks/nestjs';

@Module({
  imports: [BlypModule.forRoot()],
})
class MissingLoggerModule {}

try {
  const app = await NestFactory.create(MissingLoggerModule, {
    logger: false,
  });
  await app.init();
  await app.close();
  console.log('Unexpected bootstrap success');
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
