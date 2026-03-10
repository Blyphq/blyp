/// <reference lib="dom" />

export {
  BlypError,
  HTTP_CODES,
  getHttpCode,
  parseError,
} from '../dist/index';
export type {
  BlypErrorCode,
  BlypErrorCodeDefinition,
  BlypErrorLike,
  ErrorLogLevel,
  ErrorLoggerLike,
  ParseErrorOptions,
  ParseableErrorPayload,
} from '../dist/index';
export { createClientLogger, logger } from './frameworks/client';
export type {
  ClientLogger,
  ClientLoggerConfig,
  ClientLogBrowserContext,
  ClientLogDeviceContext,
  ClientLogEvent,
  ClientLogLevel,
  ClientLogPageContext,
  RemoteDeliveryConfig,
  RemoteDeliveryDropContext,
  RemoteDeliveryFailureContext,
  RemoteDeliveryFailureReason,
  RemoteDeliveryRetryContext,
  RemoteDeliverySuccessContext,
} from './frameworks/client';
