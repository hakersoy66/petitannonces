# Petit Annonces 2.0 — Architecture

## Architectural style

Start as a modular monolith in a monorepo, with strict domain boundaries and provider adapters. This reduces operational complexity while preserving a clean path to split high-load services later.

## Applications

- `apps/web`: public marketplace and authenticated user experience
- `apps/admin`: moderation, support, finance, compliance and operations
- `apps/api`: domain API and background-job entrypoints
- `apps/mobile`: reserved for React Native/Expo once API contracts stabilize

## Shared packages

- `packages/ui`: design system
- `packages/database`: Prisma schema/client/migrations
- `packages/types`: shared domain/API contracts
- `packages/config`: lint/TypeScript/env configuration
- `packages/auth`: authentication/session helpers
- `packages/payments`: PSP abstraction
- `packages/search`: search abstraction and indexing contracts
- `packages/notifications`: email/SMS/push abstraction
- `packages/security`: risk/security primitives

## Bounded domains

### Identity
Users, sessions, credentials, verification, MFA.

### Marketplace catalog
Categories, dynamic attributes, listings, media, locations and lifecycle.

### Discovery
Search, autocomplete, facets, ranking, saved searches and recommendations.

### Communication
Conversations, messages and marketplace offers.

### Commerce
Orders, payments, platform fees, refunds, payouts and transaction ledger.

### Fulfilment
Shipping providers, labels, tracking and delivery states.

### Trust & Safety
Reports, moderation, appeals, fraud/risk and prohibited-product policy enforcement.

### Professional commerce
Businesses, trader verification, boutiques, plans and bulk tooling.

### Compliance
Consent, privacy requests, tax/DAC7 data, product safety, moderation statements and audit evidence.

### Operations
Support, notifications, analytics and admin tooling.

## Data principles

- PostgreSQL is the source of truth.
- Redis is ephemeral cache/coordination, never authoritative financial storage.
- OpenSearch is a derived search index and can be rebuilt.
- Object storage holds media; database stores metadata and access state.
- Financial state changes write an immutable ledger/event record.
- Audit events must include actor, action, target, timestamp and relevant reason/context.

## Async jobs

Use a queue for:

- media processing
- search indexing
- email/push notifications
- expiry/renewal jobs
- moderation enrichment
- product-safety checks
- payment reconciliation
- analytics rollups
- seller reporting exports

Jobs must be retryable and idempotent.

## Payment boundary

Petit Annonces must not behave as an unlicensed holder of customer funds. Marketplace payment flows are delegated to a licensed PSP through an adapter. The internal system records order/payment state and provider references but does not replace regulated PSP custody/KYC functions.

## Search strategy

Stage 1: PostgreSQL indexes and structured filtering.
Stage 2: OpenSearch for full-text, facets, geospatial queries, typo tolerance and ranking.
Stage 3: semantic/vector retrieval may enrich discovery but must never bypass hard filters, policy or availability constraints.

## Security baseline

- Strong password hashing (Argon2id where credentials are locally managed)
- Secure HTTP-only sessions/cookies
- CSRF protection where applicable
- Rate limits by actor/IP/action
- MFA required for privileged admin roles
- RBAC/least privilege
- Secrets outside source control
- Encryption in transit and at rest where provider-supported
- Immutable audit events for privileged and financial actions
- Signed/expiring media access for non-public assets
- Webhook signature verification and replay/idempotency protection

## Deployment model

GitHub -> CI -> build/test -> artifact/image -> migration gate -> deploy -> smoke checks.

No manual ZIP-based production deployment for normal releases.

## Scale-out path

Services should only be split when justified by load or operational independence. Likely early candidates:

- search/indexing
- messaging/realtime
- media processing
- notifications
- payments/reconciliation

The first production version remains modular-monolith-first.
