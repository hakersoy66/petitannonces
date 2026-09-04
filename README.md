# Petit Annonces 2.0

France-first classifieds and transactional marketplace platform.

## Vision

Petit Annonces combines modern classifieds, C2C/B2C marketplace commerce, professional storefronts, secure payments, shipping, offers, real-time messaging, moderation, fraud prevention, SEO and mobile-ready APIs in one platform.

## Product principles

- France-first UX and compliance
- Mobile-first and accessible
- Marketplace-safe payments through a licensed PSP
- Modular architecture without premature microservices
- Search and category system designed for large-scale classifieds
- Privacy, moderation and auditability by design
- SEO-friendly public pages
- Professional sellers and boutiques as first-class citizens
- API-first foundation for iOS/Android apps

## Initial architecture

- Monorepo: pnpm + Turborepo
- Web: Next.js + React + TypeScript
- Admin: Next.js + React + TypeScript
- API: modular TypeScript backend
- Database: PostgreSQL
- ORM: Prisma
- Cache / queues: Redis + BullMQ
- Search: OpenSearch
- Object storage: S3-compatible storage
- CDN/WAF: Cloudflare
- Payments: marketplace PSP adapter (Stripe Connect or Mangopay)
- Observability: structured logs + Sentry + metrics

## Core domains

- Identity & Authentication
- Users & Profiles
- Professional Sellers
- Stores / Boutiques
- Categories & Dynamic Attributes
- Listings & Media
- Search & Recommendations
- Favorites & Saved Searches
- Messaging
- Offers
- Orders
- Payments / Refunds / Payouts / Commissions
- Shipping
- Reviews
- Disputes
- Moderation
- Reports
- Fraud & Risk
- Notifications
- Subscriptions & Billing
- Tax / DAC7 data
- Support
- Admin & Audit
- Analytics

## Delivery roadmap

### Phase 0 — Foundation
- Product and domain specification
- Technical architecture
- Compliance baseline
- Repository conventions
- Security principles

### Phase 1 — Platform skeleton
- pnpm/Turborepo monorepo
- web/admin/api apps
- shared UI/config/types/database packages
- lint/typecheck/test/build CI
- Docker development services

### Phase 2 — Design system & public shell
- Responsive UI system
- Header/footer/navigation
- Homepage
- Category navigation
- Accessibility baseline

### Phase 3 — Identity
- Registration/login
- Email verification
- Sessions
- Account security
- User profiles and addresses
- RBAC for administration

### Phase 4 — Categories & listings
- Dynamic category tree
- Attribute engine
- Listing wizard
- Media pipeline
- Draft/review/published/sold/expired lifecycle

### Phase 5 — Search & SEO
- PostgreSQL filtering foundation
- OpenSearch indexing
- Autocomplete
- Facets
- Location search
- SEO routes, metadata and structured data

### Phase 6 — Messaging & offers
- Conversations
- Real-time messages
- Attachments
- Anti-spam hooks
- Make/counter/accept offer flow

### Phase 7 — Professional sellers & boutiques
- Business profile
- Seller verification fields
- Storefront
- Plans/features
- Bulk listing foundations

### Phase 8 — Transactional marketplace
- Cart/buy-now model where applicable
- Checkout
- PSP marketplace accounts
- Payments
- Platform fees
- Refunds/payouts
- Idempotency and payment event ledger

### Phase 9 — Shipping, delivery & disputes
- Carrier abstraction
- Tracking
- Delivery state machine
- Buyer protection workflow
- Evidence and dispute resolution

### Phase 10 — Trust, moderation & fraud
- Listing reports
- Moderation cases
- Restricted/prohibited goods rules
- Risk scoring
- Device/session/security events
- Appeals and audit trail

### Phase 11 — France/EU compliance implementation
- GDPR/CNIL controls
- DSA notice/action and trader traceability flows
- GPSR marketplace/product-safety fields and workflows
- DAC7 seller tax data/reporting foundations
- Consumer-information flows for professional sellers
- Cookie consent management
- Accessibility statement and controls

### Phase 12 — Admin, support & analytics
- Operations dashboard
- Moderation console
- Fraud console
- Support tickets
- Finance/transaction views
- Business analytics

### Phase 13 — Growth & monetization
- Featured listings
- Boosts
- Sponsored placements
- Subscription plans
- Saved-search alerts
- CRM/marketing hooks

### Phase 14 — Mobile/PWA
- PWA
- Shared API contracts
- iOS/Android application foundation
- Push notifications

### Phase 15 — Production hardening
- Security review
- Load testing
- Backup/PITR drills
- Disaster recovery
- Monitoring/alerts
- Production launch checklist

## Engineering rules

1. Money is represented using integer minor units, never floating point.
2. Payment operations are idempotent and audit logged.
3. User-uploaded media is private until validation/publication rules allow exposure.
4. Category-specific listing attributes are data-driven, not hardcoded into page components.
5. Public listing/category URLs are stable and SEO-safe.
6. Admin actions with compliance or financial impact create immutable audit events.
7. Sensitive data is minimized and access controlled.
8. Business logic lives outside UI components.
9. External providers are behind adapters so they can be replaced.
10. Production changes go through GitHub and CI/CD; no manual ZIP deployment workflow.

## Status

Phase 0 started on 2026-09-04.
