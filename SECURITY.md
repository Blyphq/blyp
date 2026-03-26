# Security Policy

## Reporting a Vulnerability

Report suspected vulnerabilities through GitHub's private vulnerability reporting flow for `Blyphq/blyp`.

- Use the repository's private security advisory reporting feature.
- Do not open a public GitHub issue for suspected security issues.

Include a description of the issue, affected versions, impact, reproduction steps, and any suggested mitigations if available.

## Response Commitment

- We will acknowledge new reports within 3 business days.
- After initial review, we will follow up with triage status and next steps once we have reproduced or scoped the issue.
- Fix timelines depend on severity, exploitability, and maintainer availability.

## In Scope

The following are considered security issues for Blyp:

- Vulnerabilities in the published `@blyp/core` package code.
- Issues that can lead to data exfiltration, secret leakage, log tampering, unsafe deserialization, arbitrary file access or write, command execution, SSRF, or bypass of documented security guarantees.
- Authentication or header redaction bypasses that expose secrets or sensitive request metadata.
- Dependency compromises that materially affect the shipped runtime package behavior.
- Vulnerabilities in first-party code paths used by official runtime integrations shipped from this repository.

## Out of Scope

- Vulnerabilities in third-party services or connector providers themselves, including Better Stack, PostHog, Databuddy, Sentry, and OTLP backends.
- Misconfiguration in downstream applications or infrastructure.
- Issues in optional peer dependencies unless Blyp's own code introduces the vulnerability or unsafe integration behavior.
- Dev-only tooling issues that do not affect the published package or the maintainer release process.

## Disclosure Process

Please allow time for coordinated investigation and remediation before public disclosure.

When a report is confirmed and fixed, maintainers may publish a GitHub security advisory and reference the fix in release notes.

## Supported Versions

Security fixes are targeted at:

- The latest published release on npm.
- The current `main` branch.
