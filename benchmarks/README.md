# Benchmarks

This directory contains the public benchmark suite for `@blyp/core`.

## Scope

- Plain throughput: `logger.info('message')` with no connectors and no real I/O
- Structured throughput: equivalent structured event emission
- File throughput: real NDJSON file logging to temp directories
- Memory overhead: at rest and after fixed logging bursts

## Tooling

- Runtime: Bun
- Benchmark runner: `mitata`
- Baselines: Pino and Winston

## Commands

```bash
bun run benchmark
bun run benchmark:json
bun run benchmark:report
bun run benchmark:update-docs
```

## Methodology

- Disable pretty output for benchmark runs.
- Disable connector delivery during throughput runs.
- Use identical benchmark payloads across libraries.
- Validate the hot path with internal no-op destination plumbing plus a real-I/O guard.
- Record Bun version, CPU model, platform, and git SHA with every result.
- Treat shared CI numbers as comparable only against runs from the same environment class.

## Outputs

- `benchmarks/results/latest.json`
- `benchmarks/results/latest.md`
- `benchmarks/results/<timestamp>.json`
- `benchmarks/results/<timestamp>.md`
- `benchmarks/fixtures/results/latest.json`
- `benchmarks/fixtures/results/latest.md`
