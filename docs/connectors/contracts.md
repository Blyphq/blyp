# Operational connector contracts

Blyp's PostHog and Sentry connectors deliver operational logs and handled exceptions. Keep `posthog-js`/`posthog-node` product analytics, identity lifecycle, replay, flags and business events in application adapters. Browser applications import `@blyp/core/client`; Node SDKs and credentials belong on the server. Install each destination's optional peer SDKs. Automatic Node connectors resolve the public package exports; no sender shim or modification of `node_modules` is needed.

## Errors and severity

Each accepted error-bearing log produces one log and one handled exception at each enabled automatic destination. PostHog additionally requires `errorTracking.enabled` and `errorTracking.mode: 'auto'`. A PostHog error tracker explicitly captures exceptions in manual mode. Sentry's manual logger is an explicit destination API. Ordinary messages, including ordinary error-level messages, do not create issues. An exception is recognized independently of severity.

These forms are supported by standalone loggers:

```ts
logger.error(new Error('Failed'));
logger.error('Operation failed', { error: new Error('Failed') });
logger.error('Operation failed', {
  error: { name: 'Error', message: 'Failed', stack: originalStack },
});
logger.warning(new Error('Recoverable failure'));
logger.info('Expected condition', { error: new Error('Condition') });
```

The canonical metadata contract is exported as `ExceptionContext`; the error representation is `SerializedException`. Serialized exceptions require a string `message`; `name`, `stack` and `cause` are optional. Native Error arguments, `record.error`, `data.error`, and bare normalized Error data with both `name` and `message` are supported. Browser ingestion also recognizes the transported error in its nested `data` object. Arbitrary metadata with only a `message` is not an exception. Normalize multiple trailing arguments into one metadata object; arrays of arbitrary arguments are not searched for errors.

Original stacks are preserved. A missing transported stack stays missing instead of being attributed to the connector. Error causes are reconstructed recursively; circular native causes are safely normalized. Source filenames, functions and line/column numbers remain available when source context is disabled. Sanitization can intentionally alter error strings before reconstruction.

| Blyp level | OTLP log severity | Sentry exception level | PostHog exception property |
| --- | --- | --- | --- |
| debug | DEBUG / 5 | debug | `blyp.level: debug` |
| info, success, table | INFO / 9 | info | original Blyp level |
| warning, warn | WARN / 13 | warning | `blyp.level: warning` |
| error | ERROR / 17 | error | `blyp.level: error` |
| critical | FATAL / 21 | fatal | `blyp.level: critical` |

PostHog exceptions are `$exception` events, regardless of log severity. Console exception autocapture is separately controlled by `enableExceptionAutocapture`; set it to `false` alongside application logging to avoid feedback loops.

## Identity, correlation and child loggers

Server metadata overrides the same field in child bindings; child bindings override parent bindings. Overrides are shallow: a record's `tags`, `extra` or `contexts` object replaces an inherited object rather than merging nested keys. Child loggers share connector buffers and flush results with their parent.

| Field | PostHog OTLP log | PostHog exception | Sentry exception |
| --- | --- | --- | --- |
| `distinctId` | attribute and serialized payload | person identity, preferred over `userId` | contextual payload only |
| `userId` | attribute and payload | identity fallback | `user.id` |
| `organizationId` | attribute and payload | property | Blyp payload/context; no implicit SDK organization |
| `requestId` | attribute and payload | property; never person identity | Blyp payload/context |
| `traceId` | `blyp.trace_id` and payload | correlation property | `blyp.trace_id` in Blyp context |
| `$session_id` | attribute and payload | `$session_id` | Blyp payload/context |
| `region`, `environment`, `release`, `service` | attributes and payload | properties | Blyp payload/context |

These values are application assertions. Blyp cannot authenticate them: only attach identity after verifying authentication, and never use API keys as identity. Browser ingestion ignores browser-supplied person/organization identity, including the historical `metadata.posthogDistinctId`. Use server-side `clientLogging.enrich` to return verified `userId`, `distinctId`, and `organizationId` in `serverContext`. Browser session IDs and page fields are correlation data, not authentication. Direct sender calls with `source: 'client'` follow the same rule.

Blyp's PostHog log provider is local to the connector. It never registers a global trace, metric or log provider. Framework request IDs reuse a valid active OpenTelemetry span's trace ID when `@opentelemetry/api` is installed, and otherwise generate Blyp correlation IDs. Explicit standalone `traceId` remains correlation metadata; it does not create an OpenTelemetry span or change the SDK's active trace. Sentry's own trace context remains controlled by existing framework instrumentation.

## Sentry scope and initialized clients

Only these typed fields configure the event scope:

- `tags`: string values, applied as tags.
- `extra`: additional exception extras.
- `fingerprint`: array of strings.
- `contexts`: named object contexts or `null`.
- `userId`: verified user ID; absent identity clears the event's inherited SDK user.

Arbitrary metadata is retained as Blyp context/payload; it is not interpreted as a DSN, transport, integration or sampling setting. Scope changes occur inside `withScope` and cannot change another request's global user. An existing application Sentry client is reused, including its transport, integrations, DSN, sampling and hooks. Conflicting connector options warn instead of reinitializing it. Blyp initializes Sentry only when enabled, a DSN exists, and there is no existing client. To deliver Sentry logs, the application-owned client must enable logs. Blyp shutdown leaves that client usable.

## Final-payload privacy

Blyp's record redaction runs before connector delivery. Configure custom patterns for application-specific secrets, including those in messages, stacks, URLs and nested causes. Earlier sanitization alone cannot protect against SDK source enrichment.

PostHog `errorTracking.beforeSend` accepts the Node SDK's `before_send` function or array. These hooks run after exception enrichment, in order; returning `null` drops the event. After application hooks, Blyp strips `pre_context`, `post_context` and `context_line` unless `includeSourceContext: true`. This option defaults to false. Hook failures surface as delivery failures. Operational OTLP logs use Blyp record redaction and do not pass through the exception SDK hook.

Sentry `finalPayloadFilter(payload, kind)` receives a Blyp exception event or serialized log after the SDK and the application's existing `beforeSend`/`beforeSendLog`. Return a replacement object or `null` to drop it. Returning `null` and throwing both fail closed for that payload. Source lines are stripped from Blyp exceptions after the filter unless `includeSourceContext: true`. The filter is composed through the client's `beforeEnvelope` hook; application initialization options are preserved. Exception event IDs also identify events if an application hook replaces their extras. Log hooks should retain Blyp attributes so the connector can identify its records. Other framework events remain subject to the application's privacy hooks. Keep the same final privacy policy on framework events that can bypass Blyp.

Hooks deliberately dropping events count as completed processing, not confirmed destination delivery. Do not use filtering as an audit-delivery mechanism.

## Flush and shutdown

```ts
const result = await logger.flush({ timeoutMs: 1500 });
// Standalone result: { status, destinations: { posthog, sentry, sink, ... } }
// Each destination: { status: 'delivered' | 'failed' | 'timed_out', pending, error? }
```

The default timeout is 5,000 ms. Existing callers can continue ignoring the return value. Other framework/adaptor loggers can still return `void`; standalone and direct PostHog/Sentry loggers return completion results. Invalid timeout values reject. Sink/queue failures and connector failures are isolated so all destinations get a flush attempt.

The barrier accounts for work accepted before flush began. PostHog includes asynchronous log emits, exception enrichment, exception network requests and SDK log/exception buffers. SDK 5.28.1's `captureExceptionImmediate()` and `flush()` alone do **not** form this barrier: its immediate method resolves early and SDK flush doesn't join exception enrichment. Blyp observes the SDK's public `addPendingPromise` method and error events. Multiple simultaneous flushes are supported. Captures arriving during a flush are accepted and a subsequent barrier covers them; implementations may include some later work too.

`delivered` means the connector's observed delivery work has completed successfully. It is not an exactly-once receipt, backend indexing guarantee, or durable business-event acknowledgment. Sentry flush drains its application-owned SDK, so it can include framework telemetry too. Sentry exposes exception response failures, but its SDK can swallow log transport failures or drop/rate-limit telemetry without a per-log acknowledgment. Those cases cannot be turned into guaranteed log delivery by Blyp. Application hooks may drop events. Destination failures observed by these connectors latch for the sender lifetime, so subsequent flushes cannot falsely claim earlier lost telemetry was delivered; recreate the logger after resolving a failed destination.

`pending` counts known unsettled tasks; a timed-out SDK barrier can report one pending barrier when the SDK's internal buffer count isn't public. Failed results can have zero pending tasks: the work finished unsuccessfully.

A flush timeout bounds the caller's wait and leaves settlement handlers attached. It does not itself cancel a shared SDK flush or discard buffers. For PostHog exceptions, `requestTimeoutMs` (default 5,000) aborts underlying SDK HTTP requests; immediate requests are not retried by Blyp's private exception client. OTLP uses its SDK transport timeout. Sentry retains the application's transport and its cancellation policy; Blyp cannot safely abort that shared transport. Late failures are handled and visible to later barriers without unhandled rejections. SDK memory buffers can continue working after timeout, but are lost when the process exits.

`shutdown(options)` flushes first. On success it closes Blyp-owned PostHog resources and removes Blyp's Sentry hooks, while keeping the application Sentry client open. An incomplete shutdown returns the incomplete result and leaves remaining work to SDK transport timeouts; it must not be interpreted as successful delivery. Successful shutdown is terminal for these connectors: subsequent sends/captures are ignored so delivery cannot bypass removed privacy hooks. Serverless handlers should explicitly await a bounded flush in their request lifecycle.

## Deduplication and ownership

Use `createErrorCaptureRegistry({ ttlMs: 60000 })` to coordinate the original object separately from a sanitized representation. `claim(original, 'sentry' | 'posthog')` returns a claim with `settle(status)`, or `undefined` for a repeated live claim. `shouldSuppress(original, destination)` defaults to suppressing only delivered claims. `includePending: true` explicitly opts into suppression while delivery is uncertain. Claims are weakly keyed by object, limited to the two supported destinations, and expire. Distinct objects with identical messages remain independent. Keep one registry per application ownership boundary; no global message-text deduplication is performed.

This is an application coordination primitive, not an automatic capture receipt. Settle claims from the relevant flush result; that result still has the SDK limitations above. If a destination is disabled, filtered, or has missing credentials, do not claim delivery merely because flushing its empty buffer succeeds.

Suppressing framework capture while a claim is pending prevents duplicates but can lose the error if Blyp later fails or the process exits. Failure/timeout releases the claim for future capture; it cannot resurrect a framework event already dropped. Suppress only delivered claims when losing the fallback is unacceptable, accepting that a rethrow before delivery can duplicate the occurrence. For strict ownership, await delivery before rethrow/capture, or retain an application fallback. A destination-wide flush failure may concern other events too, so it is deliberately conservative.

Browser PostHog autocapture serializes exceptions; the original object identity is no longer present in its event hook. Matching exact observed browser errors, short-lived suppression entries and native SDK hooks remain application-owned. Never dedupe solely by message. Blyp does not implement browser replay, flags, person lifecycle or business-event delivery.

## No-persistence operation

With `file.enabled: false`, no database adapter, and `connectors.delivery.enabled: false`, explicit logger initialization does not create logs, a SQLite queue, config files or `.gitignore`. Importing server entrypoints no longer eagerly initializes a default logger. This path is tested in fresh directories by checking all directory contents. Calling the default logger or explicit `loadConfig()` retains the historical project-bootstrap behavior; use an explicitly configured logger for ephemeral/serverless applications.

Missing optional credentials skip delivery without breaking startup. Enabled destinations with credentials still require installed peer SDKs. Connector delivery errors are caught and reflected in flush results; they do not throw from ordinary logging calls. Durable delivery disabled means best effort, bounded by process lifetime. No persistence is added to improve connector flushing.
