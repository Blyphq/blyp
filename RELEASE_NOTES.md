# 0.1.32 — connector reliability

- Fix automatic PostHog/Sentry connector loading from packed CommonJS and ESM installations. Sender factories are exported through the existing public connector entrypoints; install-time bundle patches are no longer required.
- Automatically capture native and supported serialized error-bearing records at every severity. Ordinary messages remain logs. PostHog honors the error-tracking enable/mode switches.
- Restore transported exception stacks and nested causes; avoid connector-generated stacks for serialized errors without a stack.
- Complete PostHog flush across OTLP logs, SDK exception enrichment and delivery. Fix the dedicated PostHog logger's no-op flush/shutdown. Add optional timeout/result contracts to standalone and destination loggers, and report observed Sentry exception transport failures.
- Add Sentry scope mappings for tags, extras, fingerprints, contexts and verified user IDs while preserving application initialization and per-event scope isolation.
- Strip SDK-added source lines from Blyp PostHog/Sentry exceptions by default. Add PostHog SDK `beforeSend` pass-through and Sentry final envelope filtering without replacing existing application hooks.
- Add weak, expiring object-identity ownership claims for application/framework deduplication, with explicit failure release and pending-suppression tradeoffs.
- Document identity/correlation mappings and accept Next.js 16 peers. Framework correlation reuses a valid active OTel trace instead of generating a conflicting ID.
- Make default server logger initialization lazy. Explicit no-persistence configurations skip config/.gitignore bootstrap writes and leave no SQLite queue or log files.
- Add reproducible published-package investigation and real-SDK packed-artifact CJS/ESM collector tests.

Compatibility changes: warning/info records containing supported errors now create handled exceptions in automatic mode; default source-line enrichment is removed (opt in with `includeSourceContext`); unverified browser `metadata.posthogDistinctId` is no longer used as person identity; standalone/destination flush returns completion information instead of only `void`; transported errors without a stack no longer acquire a synthetic one. Importing a server entrypoint alone no longer initializes its default logger. Existing explicit `loadConfig()` and default-logger use retain historical project bootstrap behavior. Observed delivery failures latch for the connector lifetime; recreate the logger after addressing a failed destination.

Version `0.1.32` contains these connector fixes and supersedes the local `0.1.32-carsxe.1` validation build. See [connector contracts](docs/connectors/contracts.md), [investigation](docs/connectors/investigation.md) and [CarsXE migration](docs/connectors/carsxe-migration.md).
