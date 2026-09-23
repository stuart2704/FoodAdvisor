#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @workspace/db run push-force
