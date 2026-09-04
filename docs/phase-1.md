# Phase 1 — Platform Skeleton

## Delivered

- pnpm + Turborepo workspace
- Next.js public web app
- Next.js admin app
- Fastify TypeScript API with `/health`
- Shared UI package
- Shared domain types package
- Prisma/PostgreSQL database package
- PostgreSQL + Redis local Docker services
- Environment template
- GitHub Actions CI for typecheck and build

## Local bootstrap

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm dev
```

Services:

- Web: http://localhost:3000
- Admin: http://localhost:3001
- API health: http://localhost:4000/health
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## Exit criteria

Phase 1 is complete when dependency installation, typecheck and builds pass in CI and the three application processes can boot from the monorepo.
