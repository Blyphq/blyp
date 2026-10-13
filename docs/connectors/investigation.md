# Published connector investigation

Baseline: unmodified npm tarball `@blyp/core@0.1.30`; Node 24.18.0; real `posthog-node@5.28.1`, `@sentry/node@10.43.0`, OpenTelemetry logs packages 0.206.0/resources 2.6.0. No workspace symlinks or patching of `node_modules`. The maintainer's statement that 0.1.31 only adds New Relic is the basis for treating its PostHog/Sentry behaviors as unchanged; 0.1.31 was not independently baseline-tested.

Run `npm run test:published-connectors` to download/install the baseline into a temporary fixture and print collector results. An optional version argument is accepted by `node scripts/reproduce-published-connectors.mjs VERSION`. The automatic loader failures were reproduced before implementation changes. Public destination APIs allowed further investigation despite the loader blocker. Local collector tests use randomized ports, gzip decoding, SDK envelope/log event counts and delayed responses. The specified CarsXE patch/telemetry files were not available in the local CarsXE checkout, so no claim is made about executing its existing patched test.

| Report | Published evidence | Classification and upstream change |
| --- | --- | --- |
| Automatic PostHog/Sentry loaders | Both CJS and ESM fail on missing `../connectors/*/sender` despite installed peers; tarball lacks these files. Error incorrectly suggests missing peer dependencies. | Packaging defect. Load the public conditional connector export and export sender factories; source-only paths are used solely during source execution. |
| PostHog structured errors | Six representative log calls through the public logger produce zero PostHog exceptions. | Missing automatic handled-exception bridge, rather than a documented guarantee of the old logger. Error-bearing records now capture at any severity under automatic error tracking. |
| Sentry structured errors | Native error, nested native error and nested serialized error at error severity each capture; browser filename and line survive. Warning/info errors do not capture. Context fields appear only inside serialized Blyp payload, not as scope tags/fingerprint. | Serialized error support already existed. Severity restriction and missing explicit context mapping changed; typed contracts added. |
| Flush | Dedicated PostHog logger flush is a no-op. With a 150 ms delayed collector, SDK immediate capture and SDK flush return in approximately 1 ms, before any exception request is observed. | Blyp defect plus SDK contract discrepancy. Tracking only immediate-capture promises or adding SDK flush is insufficient. Observe registered exception work and SDK error events, drain both paths, expose bounded results. |
| SDK source-context privacy | Manual PostHog tracker receiving an already sanitized error transmits `FAKE_SOURCE_SECRET_123` from its source line. | Confirmed post-enrichment leak. Source context removed by default after SDK hooks; configurable final filtering added. Sentry final filtering tested on HTTP payloads too. |
| Sentry initialization | Existing client is reused; conflicting options warn. | Existing supported behavior preserved. Framework configuration is not overwritten. |
| Deduplication | Published private PostHog marker exists; no cross-framework delivery receipt API. Serialized records have lost original identity. | Application ownership problem, not guaranteed Blyp deduplication. Add weak object-identity claims with explicit pending/delivery/failure semantics. |
| Identity | Browser ingestion trusts `metadata.posthogDistinctId`; OTLP primarily includes serialized payload. | Undocumented and unsafe trust boundary. Add explicit mappings; browser person identity must come from server enrichment/bindings. |
| No persistence | Importing the baseline server entrypoint in a fresh directory creates `blyp.config.ts` and `.gitignore`; eager default logger remains even when a later explicit logger disables persistence. Baseline fixture also sees `logs` after emitting. | SQLite delivery disabling itself is already guarded. Wider filesystem isolation exposes eager initialization/bootstrap behavior; make default logger lazy and skip bootstrap for explicit no-persistence operation. |
| Next.js 16 | Published peer range only accepts `^15`. | Compatibility metadata gap; range now accepts 15 and 16. Test the Next 16 peer, request wrapper and browser entrypoint isolation. |

The baseline collector confirms original serialized Sentry stacks work. It does not support the claim that all serialized Sentry errors were broken. Multiple trailing metadata arguments still become an array; normalize them into one object rather than relying on arbitrary array extraction. Ordinary info/warning messages must remain logs, not automatically become exceptions.

## Regression checks

`npm run test:packed-connectors` builds, runs `npm pack`, installs the resulting tarball and pinned real SDKs into an isolated application, then launches separate Node CJS/ESM consumers. The fixture checks:

- Automatic connector initialization, log records and exception counts inside HTTP payloads, including coordinated framework capture and distinct same-text errors.
- Native/serialized overloads, warning/info exceptions, ordinary-message exclusion, child overrides and concurrent verified identity.
- PostHog and Sentry final HTTP payload redaction, nested causes/URLs and stripped source lines; original frame coordinates survive.
- Delayed, failed, concurrent and simultaneous flushes; hung HTTP transport, shutdown and eventual SDK request cancellation.
- Existing Sentry client/hooks remain active and the global trace provider remains independent.
- Browser bundle has no Node connector inputs; installed Next.js 16 request wrapper reuses an active OTel trace.
- Explicit no-persistence logging in a fresh directory leaves it entirely empty, including absent config/bootstrap files.

Source regression tests additionally use controlled promises to isolate SDK-buffer flushing, late rejection after timeout, asynchronous log emission, synchronous capture errors, weak-claim failure release/expiry, cyclic causes and missing-stack handling. The packed fixtures run in separate Node processes, so unhandled rejections fail the process under Node's default strict policy.

The Next.js check is a framework-entrypoint/browser-bundle smoke test with the actual Next 16 dependency, not a production build of CarsXE or a full `@sentry/nextjs` deployment. The no-persistence assertion checks all files below the fresh runtime directory; SDK network activity and fixture installation writes outside it are intentionally separate.

## Responsibilities retained by the application

Authenticate identity, sanitize application-specific secrets, keep framework privacy hooks, choose framework/autocapture ownership, track original objects before serialization, and decide the pending-suppression loss/duplication tradeoff. Keep browser matching storage bounded and disable console autocapture when explicit logging owns it. Observe incomplete flush results without making telemetry failures change application responses. Own analytics/replay/flags and any durable business-event/outbox guarantees. A shared Sentry SDK can drop or rate-limit events and does not expose a per-log durable acknowledgment; successful flush is not guaranteed destination indexing or exactly-once delivery.
