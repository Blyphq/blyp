## Naming

- The GitHub org is `Blyphq` (Blyp HQ) — this is the org name only, not a product name
- The core logger package is `@blyp/core` (published to npm)
- The CLI package is `@blyp/cli` (published to npm)
- The CLI command is `blyp`
- Do not use the old unscoped package name — it has been replaced by `@blyp/core`
- Do not use `blyphq` as a command — the command is `blyp`

## Directories to never commit

The following directories are local dev artifacts and must never be committed:
- `tmp-debug/`
- `.tmp-types/`

They are in `.gitignore`. Do not create them, do not remove them from `.gitignore`.
