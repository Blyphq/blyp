#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUDIT_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$AUDIT_DIR"
}

trap cleanup EXIT

ROOT_DIR="$ROOT_DIR" AUDIT_DIR="$AUDIT_DIR" node <<'EOF'
const fs = require('fs');
const path = require('path');

const rootDir = process.env.ROOT_DIR;
const auditDir = process.env.AUDIT_DIR;
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const auditPackageJson = {
  name: 'blyp-production-audit',
  private: true,
  dependencies: packageJson.dependencies ?? {},
};

fs.writeFileSync(
  path.join(auditDir, 'package.json'),
  `${JSON.stringify(auditPackageJson, null, 2)}\n`
);
EOF

cd "$AUDIT_DIR"

bun install
bun audit --production
npm install --package-lock-only --ignore-scripts
npm audit --omit=dev --audit-level=high
