# Petit Annonces engineering rules

## Mandatory PWA / Android / iOS parity
Any user-facing change, bug fix, navigation change, notification behavior, account feature, marketplace flow, visual change, or new feature implemented in `apps/web` must be evaluated in the same change for `apps/mobile`.

- Android and iOS share the Expo/React Native source under `apps/mobile`; do not intentionally ship one platform behind the other unless a platform limitation is documented.
- PWA is the visual and functional reference for mobile product behavior unless a native platform convention is materially better.
- When a PWA route or feature has a native equivalent, keep naming, information architecture, actions, empty states, counters, filters, and state transitions aligned.
- Deep links from `petitannonces.fr` must resolve to the matching native screen whenever that screen exists.
- Notification read/unread state and badge counts must stay consistent across web, PWA, Android, and iOS.
- Before declaring a user-facing web task complete, run mobile typecheck/lint and update the native implementation or explicitly document why parity is not applicable.
- Before an Android release, run mobile typecheck, lint and preflight; build one AAB; upload it to Google Play Internal Testing; verify the track directly.
- For iOS, keep the same source change ready for TestFlight; Apple-specific release blockers must not prevent source parity.


## PWA-first native UI rule — 2026-09-18
- Android and iOS visible marketplace UI uses the production PWA surface through the shared native WebView shell.
- Do not recreate PWA pages as separate React Native designs. Header, cards, spacing, navigation, account pages, listing flows and Pro pages must come from the PWA source so web/PWA design changes propagate immediately.
- Native code is reserved for platform capabilities: push permission/token lifecycle, App/Universal Links, OS back behavior, secure device integrations and Store-required behavior.
- External petitannonces.fr links and native push deep-links must open the matching PWA path inside the native shell.
- If a web feature needs a native capability, bridge that capability behind the existing PWA controls instead of replacing the PWA screen.

## Agent-first release workflow
- Work directly in this server checkout; GitHub must never be required to edit, test, build, deploy, or roll back production.
- Before release, stage only task-related new files. The release helper automatically includes tracked edits, runs typechecks and diff validation, commits a local immutable release, and invokes the existing blue/green production deploy.
- Use `scripts/agent-release.sh "short change summary"` for production releases instead of pushing first.
- GitHub is a post-deploy mirror. A failed GitHub push must not roll back or block a healthy production release; the helper records a pending sync marker for the connected ChatGPT GitHub connector to reconcile.
- Never stage `.env`, credentials, signing keys, generated builds, runtime backups, or unrelated historical debris.
