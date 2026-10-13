# CarsXE agent prompt: local Blyp prerelease validation

Copy the prompt below into the CarsXE agent. The paths assume both repositories are on the same machine; copy the tarball and substitute its absolute path if testing elsewhere.

---

You are working in CarsXE. Validate Blyp's local connector prerelease against the real application, and produce actionable feedback for the Blyp maintainer.

Use this exact package:

- Version: `@blyp/core@0.1.32-carsxe.1`
- Tarball: `/Users/doughnut/Documents/github/opensource/blyp/out/carsxe-local/blyp-core-0.1.32-carsxe.1.tgz`
- Checksum: sibling `SHA256SUMS` file.
- Contracts: `/Users/doughnut/Documents/github/opensource/blyp/docs/connectors/contracts.md`
- Migration: `/Users/doughnut/Documents/github/opensource/blyp/docs/connectors/carsxe-migration.md`
- Baseline findings: `/Users/doughnut/Documents/github/opensource/blyp/docs/connectors/investigation.md`

The package is local, not published. Install the tarball rather than a registry version, workspace source link, or symlink. Confirm its checksum and actual installed version/module resolution for every tested runtime. Check the prerelease version does not conflict with other packages' peer ranges; report such conflicts rather than masking them in the application.

First inspect the repository instructions, package manager/workspace setup, working-tree state, and these files if available:

```text
apps/functions/functions_v2/scripts/patch-blyp-connectors.cjs
apps/functions/functions_v2/scripts/test-blyp-connectors.cjs
packages/shared/src/telemetry/index.ts
apps/functions/functions_v2/src/utils/telemetry/logger.ts
apps/functions/functions_v2/src/utils/telemetry/request.ts
apps/web/lib/telemetry/server.ts
apps/web/lib/telemetry/client.ts
```

Use an isolated branch/worktree or temporary fixtures and preserve existing edits. Document the current patched baseline before testing. Disable only the Blyp install-time bundle patch/version guard in the validation checkout **before installing** the tarball; do not edit distributed bundles or preserve sender shims. Update the relevant manifests and lockfile with the repository's package manager so the applications resolve the tarball. Keep unrelated install scripts intact. Adapt the application to the documented public contracts where needed and clearly report each adaptation.

For an independent initial CommonJS fixture, the basic installation is:

```sh
npm install --ignore-scripts --legacy-peer-deps \
  /Users/doughnut/Documents/github/opensource/blyp/out/carsxe-local/blyp-core-0.1.32-carsxe.1.tgz \
  posthog-node@5.28.1 @sentry/node@10.43.0 \
  @opentelemetry/api-logs@0.206.0 \
  @opentelemetry/exporter-logs-otlp-http@0.206.0 \
  @opentelemetry/resources@2.6.0 @opentelemetry/sdk-logs@0.206.0
```

Use that command only in a temporary fixture; it intentionally skips application lifecycle scripts and peer resolution. Use the application's real installed SDK versions for compatibility tests too, and record them.

Build a local HTTP collector on a random localhost port with real SDKs. Decode gzip, encoded `data=` payloads, PostHog `/batch/`, OTLP `/i/v1/logs`, and Sentry envelopes. Count events inside bodies, not HTTP requests. Initialize Sentry through the application's existing configuration, using a local DSN, `enableLogs: true`, and `defaultIntegrations: false` for the isolated collector. Preserve existing hooks and verify framework integration separately. Do not send test telemetry to production collectors.

Test all of the following:

1. Clean packed-package automatic PostHog/Sentry loading in Node CommonJS and ESM; no patch, missing sender shim, source import, or workspace symlink. Compile Firebase Functions v2/CommonJS and run the Next.js 16 server integration. Verify browser bundles exclude Node connectors and credentials.
2. Native Error, nested native Error, and `{name,message,stack,cause}` JSON errors, including browser-to-server ingestion. Test error, critical, warning and info levels. Compare exception information and original frame filename/function/line/column. Ordinary warning/info/error messages must remain logs. Test PostHog error tracking disabled/manual and console autocapture disabled.
3. One error-bearing record produces one log and one exception per intended destination. Repeat explicit logging of the same original object and simulate framework capture/rethrow using the application's supported ownership policy. Distinct same-message objects must remain distinct. Test pending suppression, failure/timeout release, bounded storage and concurrent requests. Do not confuse deduplication with guaranteed delivery: pending suppression can lose a fallback event already dropped by the framework.
4. Sentry tags, extras, fingerprint, contexts and severity; verified identity; child inheritance and per-record overrides; concurrent request isolation. Blyp must reuse the application's initialized Sentry client without replacing DSN, sampling, integrations or transport, and application hooks must still run.
5. Final HTTP payload privacy using fake secrets in messages, metadata, stacks, URLs, nested causes and source lines. Test SDK/app enrichment after initial sanitization. Use supported PostHog `errorTracking.beforeSend`, Sentry `finalPayloadFilter`, and source-context options. Secrets must be absent; useful stack coordinates must survive. Keep framework privacy hooks because framework events outside Blyp remain application-owned.
6. Bounded `logger.flush({ timeoutMs: 1500 })` and shutdown: delayed and failed delivery, a collector that never responds, captures during a flush, simultaneous flush calls, SDK buffers, late rejection and no unhandled rejections. Check `delivered`/`failed`/`timed_out` and pending results against observed events. Account for unfinished requests after timeout; do not treat an outer `Promise.race` as cancellation or SDK flush as guaranteed indexing.
7. Independently verify OTLP, PostHog exception and Sentry exception identity/correlation mappings. Verified `distinctId`/`userId` are person identity; request/trace IDs are correlation. Preserve `$session_id`, organization context and existing OTel trace/metric providers. Never use API keys or unverified browser identity. Browser `metadata.posthogDistinctId` is no longer trusted: verify identity server-side and use `clientLogging.enrich`/`serverContext`.
8. Fresh-directory no-persistence operation with `file.enabled: false`, no database adapter, `clientLogging.enabled: false`, and `connectors.delivery.enabled: false`. Check all directory contents before/after import, initialization, emit, flush and shutdown, including absent log files, SQLite, bootstrap config and `.gitignore`. Missing credentials must not break startup; telemetry failures must not change application responses.

Keep native `posthog-js`/`posthog-node` analytics, replay, flags, identity lifecycle and business events separate. Do not expand this task into new analytics capabilities or deploy/publish anything.

Run relevant application type checks, builds and telemetry tests. If a check fails, first distinguish a package regression from an intentional contract change, unsupported argument shape, stale patch, or application integration error. Use minimal supported application changes to test migration, but do not conceal missing package behavior with another private bundle patch.

Write `blyp-local-feedback.md` with:

- Exact package version/checksum, Node/SDK/framework versions, installation/resolution paths, commands and test environment.
- Per-check pass/fail/not-tested results, decoded/redacted event counts and useful payload excerpts.
- Minimal reproduction for each failure, expected versus actual behavior, and whether the defect belongs to Blyp or CarsXE.
- Every migration change and workaround still required, with file/line references.
- Delivery/privacy/deduplication limitations, regressions and release blockers.
- A final recommendation on whether CarsXE can remove the bundle patch.

Do not report acceptance checks as passed unless executed. Report limitations honestly, including any inability to run the real Firebase/Next.js integration.
