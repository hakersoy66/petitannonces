# Petit Annonces — Production Runbook

## Target architecture

- Ubuntu 24.04 LTS
- Nginx edge reverse proxy
- PM2 for `web`, `admin`, and `api`
- PostgreSQL 17
- Redis 7
- GitHub Actions gated deployment
- Release directories under `/var/www/petitannonces/releases`
- Shared secrets under `/var/www/petitannonces/shared/.env`
- Database backups under `/var/www/petitannonces/backups`

The application processes must never run as `root`. Use a dedicated `petitannonces` deploy/runtime user with only the sudo permissions required for service reloads.

## Initial server preparation

1. Apply Ubuntu security updates.
2. Create the `petitannonces` user and deploy directories.
3. Install Node.js 24, corepack/pnpm 10.15, Git, PostgreSQL client, Redis, Nginx, PM2 and Certbot.
4. Configure UFW: deny inbound by default; allow OpenSSH, 80 and 443 only.
5. Bind PostgreSQL, Redis and application ports to loopback/private networking only.
6. Put the production environment file at `/var/www/petitannonces/shared/.env` with mode `600`.
7. Install `infra/nginx/petitannonces.conf`, obtain TLS certificates, run `nginx -t`, then reload Nginx.
8. Configure PM2 startup for the non-root runtime user.
9. Validate the restricted GitHub deploy dispatcher, the blue/green PM2 services and the public health endpoint.

## Database bootstrap

The historical Phase 1–7 Prisma schema predates the SQL migration directory. For this reason **initial bootstrap is explicit and may only run on an empty database**.

```bash
cd /path/to/release
export PA_ALLOW_DB_BOOTSTRAP=true
bash scripts/bootstrap-database.sh
```

`bootstrap-database.sh` refuses to run if the public schema already contains tables. Normal deployments never execute `prisma db push`.

After bootstrap, `scripts/apply-sql-migrations.sh` is the canonical incremental migration runner. It stores migration name + SHA-256 in `pa_sql_migrations` and fails if an already-applied migration file changes.

All future database changes must be additive/expand-first SQL migrations. Destructive contract migrations require a separate release after old application versions no longer depend on the old schema.

## Deployment

Production deploys are gated by the repository variable:

`PRODUCTION_DEPLOY_ENABLED=true`

Required GitHub `production` environment secret:

- `PRODUCTION_SSH_PRIVATE_KEY`

The production hostname, restricted SSH user and pinned ED25519 host key are explicit in the deployment workflow. The SSH key is forced through `pa-github-dispatch`; it does not provide an unrestricted shell.

A deployment only starts after CI succeeds on `main`. The remote deploy path:

1. accepts only the exact 40-character commit SHA that passed CI;
2. creates a verified PostgreSQL backup before changing production;
3. fetches and resets the repository to that exact SHA;
4. runs `pnpm install --frozen-lockfile`;
5. applies checksum-validated SQL migrations;
6. builds the inactive blue/green web, admin and API release;
7. starts the inactive PM2 color on isolated loopback ports;
8. waits for web, admin and API readiness checks;
9. validates Nginx and atomically switches the upstream ports;
10. verifies public `/healthz` and the listing publication route;
11. drains the old Nginx workers before retiring the previous PM2 color;
12. leaves the currently serving color untouched if the new release fails before the switch.

Database migrations are not automatically rolled back. Schema changes must therefore follow expand/contract compatibility rules.

## Manual rollback

```bash
cd /var/www/petitannonces/current
bash scripts/rollback-production.sh
```

Or target a specific retained release:

```bash
bash scripts/rollback-production.sh <git-sha>
```

## Health endpoints

- `/health/live`: process liveness only
- `/health/ready`: PostgreSQL readiness and optional Redis TCP readiness
- public Nginx alias: `/healthz`

Set `REQUIRE_REDIS_READY=true` in production so Redis failure removes the API from readiness.

## Backup policy

The deploy script creates a database backup before every migration. These local backups protect against deployment mistakes but are **not an off-site disaster-recovery strategy**.

Before public launch, configure one of:

- DigitalOcean Managed PostgreSQL with PITR/backups; or
- encrypted daily `pg_dump` transfer to an independent S3-compatible bucket.

Perform a restore drill at least monthly. A backup that has not been restored successfully must not be considered verified.

## Monitoring and alerts

Minimum alerts before launch:

- `/healthz` unavailable
- API 5xx rate
- CPU/load saturation
- memory/swap pressure
- disk usage > 80%
- PostgreSQL connection exhaustion
- Redis unavailable
- failed GitHub deployment
- backup failure
- payment/shipping webhook failure rate

## Security baseline

- SSH keys only; GitHub production deploys must use the restricted forced-command dispatcher rather than an unrestricted shell.
- No public PostgreSQL/Redis ports.
- Nginx request/body limits and per-IP API rate limiting.
- TLS 1.2/1.3 only; HSTS after certificates and all subdomains are confirmed HTTPS-ready.
- Secrets live only in the shared environment file / GitHub environment secrets, never in Git.
- Rotate payment, shipping, VAPID, cron and registry provider secrets independently.
- Keep admin on `admin.petitannonces.fr`; protect with application RBAC and optionally Cloudflare Access before launch.

## Launch gate

Do not enable automatic production deployment until all of these are true:

- restricted GitHub production dispatcher active and tested
- DNS points to the intended production server
- TLS certificates valid
- PostgreSQL/Redis installed or managed endpoints configured
- initial database bootstrap completed once
- production `.env` complete
- Nginx config validated
- PM2 processes healthy
- CI migration smoke test green
- payment provider no longer uses `mock`
- shipping provider/webhook configuration production-ready
- off-site database backup or managed PITR enabled
- rollback drill completed