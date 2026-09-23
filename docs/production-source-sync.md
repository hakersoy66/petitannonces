# Production source synchronization

Date: 2026-09-23

The `production-sync-20260923` branch was reconciled against the live Petit Annonces production source tree.

Validation before merge:
- production/source parity checked with normalized line endings;
- 710 production source/config files match;
- the only intentional runtime-source differences are `apps/web/package.json` and `pnpm-lock.yaml`, where missing Font Awesome dependencies were declared and locked;
- database migration smoke test, TypeScript typecheck, full build, and build-artifact verification must pass before merge.

SentinelX is not part of the production control path.
