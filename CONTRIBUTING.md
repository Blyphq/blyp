# Contributing to Blyp

Contributions are welcome. This guide explains how to get set up and submit changes.

## Quick start

1. Fork the repository.
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/blyp.git && cd blyp`
3. Install dependencies: `bun install`
4. Run tests: `bun run test`
5. Create a branch: `git checkout -b feature/your-change`
6. Make your changes and run tests again.
7. Push and open a Pull Request.

## Development setup

**Prerequisites**

- [Bun](https://bun.sh) 1.2+ (recommended) or [Node.js](https://nodejs.org) 18+
- [TypeScript](https://www.typescriptlang.org) 5.0+

**Commands**

| Command | Description |
|--------|-------------|
| `bun install` | Install dependencies |
| `bun run test` | Run the test suite |
| `bun run test:watch` | Run tests in watch mode |
| `bun run build` | Build the project |
| `bun run type-check` | Type check without emitting |
| `bun run lint` | Run lint (type-check) |

To run a single test file, for example one framework suite:

```bash
bun test tests/frameworks/elysia.test.ts
```

## What to contribute

- Bug fixes
- Documentation improvements
- New features
- New framework integrations

For large features or new framework integrations, open an issue first to discuss.

## Code and style

- Use TypeScript and follow existing patterns in `src/` and `tests/`.
- New features should include tests. Core and helpers live in `tests/`; framework integrations in `tests/frameworks/`.
- Prefer small, focused pull requests.

## Pull request process

1. Ensure all tests pass (`bun run test`).
2. Keep one logical change per PR.
3. Update the README or [docs](docs/README.md) if behavior or the public API changes.
4. Address maintainer feedback promptly.

## Reporting issues

Use [GitHub Issues](https://github.com/Blyphq/blyp/issues). For bugs, please include:

- A clear description of the problem
- Steps to reproduce
- Your environment (Bun or Node version, OS)

## Proposing features

For larger changes, open an issue to discuss before sending a PR. This helps align on design and scope.
