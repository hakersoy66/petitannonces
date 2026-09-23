# Production control channel

## Primary path

Petit Annonces application changes use GitHub as the source of truth:

1. edit and commit to `main`;
2. GitHub Actions CI runs database smoke tests, TypeScript checks and production builds;
3. the production deploy workflow uses the existing restricted SSH deploy channel;
4. production health is verified after deployment.

This path does not depend on SentinelX, Gmail command polling, or PA Agent nonces.

## Fallback path

PA Agent remains available for bounded health checks, logs, repository-scoped diagnostics and emergency rollback. It is not the default path for normal source changes.

Remote Desktop Commander is an optional break-glass terminal path when its device connector is online.

## SentinelX

SentinelX is no longer part of the Petit Annonces production control path.
Production synchronization is validated through the isolated `production-sync-20260923` branch before any merge to `main`.
