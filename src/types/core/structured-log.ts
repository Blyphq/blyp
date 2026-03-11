export type StructuredLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'warning'
  | 'error'
  | 'success'
  | 'critical'
  | 'table';

export interface StructuredLogError {
  message: string;
  code?: string | number;
  type?: string;
  stack?: string;
  why?: string;
  fix?: string;
  link?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface StructuredLogEvent {
  level: StructuredLogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

export type StructuredLogPayload<
  TFields extends Record<string, unknown> = Record<string, unknown>,
> = TFields & {
  groupId: string;
  timestamp: string;
  level: StructuredLogLevel;
  method?: string;
  path?: string;
  status?: number;
  duration?: number;
  events?: StructuredLogEvent[];
  error?: StructuredLogError;
};

export interface StructuredLogEmitOptions {
  response?: Response | { status: number };
  status?: number;
  error?: unknown;
  level?: StructuredLogLevel;
  message?: string;
}

export interface StructuredLog<
  TFields extends Record<string, unknown> = Record<string, unknown>,
> {
  set<TNextFields extends Record<string, unknown>>(
    fields: TNextFields
  ): StructuredLog<TFields & TNextFields>;
  debug(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  info(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  warn(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  warning(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  error(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  success(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  critical(message: unknown, ...args: unknown[]): StructuredLog<TFields>;
  table(message: string, data?: unknown): StructuredLog<TFields>;
  emit(options?: StructuredLogEmitOptions): StructuredLogPayload<TFields>;
}

export interface CreateStructuredLogOptions {
  initialFields?: Record<string, unknown>;
  resolveDefaultFields?: () => Record<string, unknown>;
  write(payload: StructuredLogPayload<Record<string, unknown>>, message: string): void;
  onCreate?: () => void;
  onEmit?: (payload: StructuredLogPayload<Record<string, unknown>>) => void;
}
