# PWA / Native parity policy

Petit Annonces treats PWA, Android, and iOS as one product surface.

## Current rule
PWA behavior is the baseline for feature completeness. Native Android/iOS must be updated in the same engineering pass for user-facing changes.

## Release gate
1. Web/PWA behavior implemented and tested.
2. Matching native route, action, state and visual hierarchy checked.
3. Native typecheck + lint + Expo dependency compatibility check.
4. Android Internal Testing release updated for native-impacting changes.
5. iOS source remains release-ready for TestFlight; publish when Apple access/signing is available.

## Notifications
- Notification center shows unread notifications only.
- Marking a notification as read removes it from the current list.
- Tout marquer comme lu clears the visible unread list and resets the app badge.
- Push state and notification-category preferences are managed from the same notification center.
- PWA/native category groups: Messages, Recherches, Favoris, Ventes, Système.


## Implemented parity baseline — 2026-09-18
- Shared Android/iOS notification center: unread list, per-item read/removal, read-all/removal, badge synchronization, device push on/off and notification-category preferences.
- Shared native Pro modules: CRM pipeline, team/roles, appointments, listings, promotions, analytics, imports, subscription, stores, orders, reservations and wallet.
- Unknown trusted `petitannonces.fr` application links use the in-app PWA bridge instead of being transformed into an unrelated search.
- Native equivalents remain preferred for listings, messages, account, notifications, Pro workflows and commerce.
- Google Play Internal Testing baseline: `2026091825` (`completed`).


## PWA-first native UI rule — 2026-09-18
- Android and iOS visible marketplace UI uses the production PWA surface through the shared native WebView shell.
- Do not recreate PWA pages as separate React Native designs. Header, cards, spacing, navigation, account pages, listing flows and Pro pages must come from the PWA source so web/PWA design changes propagate immediately.
- Native code is reserved for platform capabilities: push permission/token lifecycle, App/Universal Links, OS back behavior, secure device integrations and Store-required behavior.
- External petitannonces.fr links and native push deep-links must open the matching PWA path inside the native shell.
- If a web feature needs a native capability, bridge that capability behind the existing PWA controls instead of replacing the PWA screen.

## PWA-first release baseline
- Android Internal Testing baseline: `2026091826` (`completed`).
- AAB SHA-256: `fe2996c3f524174bb10ff854d46b37127964b4ad55cf7efe200e5d71114b7652`.
- iOS final PWA-first export: passed.
- Admin alerts: new member (web/native/OAuth) and pending listing (ADMIN/SUPER_ADMIN) are production-enabled.
