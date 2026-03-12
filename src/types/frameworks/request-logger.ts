export interface RequestScopedLoggerOptions {
  resolveStructuredFields?: () => Record<string, unknown>;
  onStructuredEmit?: () => void;
}

export interface HttpErrorCaptureContext {
  error?: unknown;
  distinctId?: string;
}
