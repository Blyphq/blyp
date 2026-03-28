# Stability

This document is Blyp's canonical compatibility contract for production adopters.

## Why this exists

During Blyp's early releases, the npm package name changed from `blyp-js` to `@blyp/core`, the CLI executable changed from `blyphq` to `blyp`, and TypeScript subpath declaration shims were fixed after release. Those changes created uncertainty about what production users can rely on.

This file defines the stability guarantees for Blyp's public surfaces going forward.

## Stability tiers

| Area | Tier | Guarantee |
| --- | --- | --- |
| Core logger API (`logger.*`, `createStructuredLog`, `createError`) | Stable | No breaking changes without a major version bump |
| Framework adapters (`@blyp/core/hono`, `/nextjs`, etc.) | Stable | Same guarantee |
| Connector APIs | Stable | Same guarantee |
| Studio UI | Beta | May change between minor versions |
| CLI commands | Beta | Commands may be added/changed with minor version |
| Internal APIs / unexported symbols | Unstable | No guarantees |

## Deprecation policy

- Stable APIs are deprecated before removal.
- Deprecations are called out in GitHub release notes and changelog entries.
- Deprecated Stable APIs remain available for at least one minor release before removal.
- Removing a Stable API is a breaking change and therefore requires a major version bump.
- Beta surfaces may change in a minor release without a deprecation window.
- Unstable and internal surfaces may change at any time.

## How breaking changes are communicated

Blyp communicates breaking changes through these channels:

- GitHub Releases in `Blyphq/blyp` are the authoritative release-note channel for package changes.
- Changelog entries, including the docs changelog, provide the human-readable running history.
- Migration notes are included when a release changes common adoption paths or requires user action.

## Bun vs Node support

"Blyp-first" means Blyp is designed around Bun as the primary optimization target while maintaining feature parity for Stable documented APIs on Bun and supported Node versions.

- Stable documented APIs are intended to work on Bun and supported Node versions.
- Bun may receive earlier runtime-specific optimizations or validation when runtime behavior differs.
- Node support is not best effort for Stable surfaces.
- If a documented capability cannot ship with Stable parity on Node, it must be documented as Beta or explicitly scoped to Bun before release.

## Out of scope

This contract does not cover:

- private helpers
- unexported symbols
- internal file layout
- undocumented implementation details
- behavior that is present in source but not documented as part of a public API
