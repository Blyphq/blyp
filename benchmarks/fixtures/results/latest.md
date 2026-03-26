Snapshot generated from `82cb03e1a836e8ea3c66fdeffd35c87e9cb4f18b` on 2026-03-26T14:31:50.656Z.

Bun `1.3.9` on AMD Ryzen 7 7445HS w/ Radeon 740M Graphics (linux/x64).

| Scenario | Blyp | Pino | Winston | Blyp vs Pino |
|---|---:|---:|---:|---:|
| Baseline throughput | 84,562 | 1,672,468 | 333,778 | -94.9% |
| Structured log throughput | 24,321 | 796,544 | 257,521 | -96.9% |
| File destination throughput | 45,658 | 403,309 | 17,906,466 | -88.7% |

| Scenario | Blyp heap delta | Pino heap delta | Winston heap delta |
|---|---:|---:|---:|
| Heap at rest after logger creation | 0 | 0 | 0 |
| Heap delta after plain logging burst | 0 | 0 | 0 |
| Heap delta after structured logging burst | 3,336,210 | 0 | 0 |
| Heap delta after file logging burst | 0 | 0 | 4,565,763 |