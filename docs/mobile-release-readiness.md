# Mobile release readiness — 2026-09-12

## Verified
- Expo SDK 57 configuration passes Expo Doctor 21/21.
- Mobile ESLint passes with 0 errors / 0 warnings; TypeScript passes.
- Fresh production Expo exports succeed for Android and iOS after the final Store asset/config changes.
- Production Store assets verified: opaque 1024×1024 iOS icon and 1024×1024 Android adaptive icon.
- Public account-deletion resource is live at `https://petitannonces.fr/supprimer-mon-compte` and in-app deletion remains available under Confidentialité & compte.
- Development: `fr.petitannonces.app.dev`, scheme `petitannonces-development`.
- Preview: `fr.petitannonces.app.preview`, scheme `petitannonces-preview`.
- Production local default remains `fr.petitannonces.app`, scheme `petitannonces`, but production build is now blocked unless explicit Store IDs are supplied. Known Play records are `fr.petitannonces` and `fr.petitannonces.petitannoncesapp`; Apple App Store Connect App ID is `6759097498` while its bundle ID still needs console confirmation.
- Expo generated `exp+petit-annonces` scheme is development-only; Preview/Production do not register it.
- Real Dev + Preview prebuilds verified Android `applicationId`/namespace and iOS `PRODUCT_BUNDLE_IDENTIFIER`.
- Camera/photo/Face ID privacy strings are French; Android `RECORD_AUDIO` is explicitly removed.
- Native payment return bridges are variant-aware for marketplace checkout, Vacances deposit, wallet, listing renewal, promotions and Pro subscription.
- Store-safe native digital billing gates default OFF for PA credit purchase, paid listing renewal, promotions/boosts and Pro subscriptions.
- Physical marketplace checkout and Vacances deposits remain available through their existing payment flows.
- Production build has a hard preflight guard: it cannot start until production identity is explicitly confirmed, EAS is authenticated, and an EAS projectId exists.

## Current blockers / deferred gates
1. **Android source/config preflight is clear (0 blockers)** for the confirmed Google Play package `fr.petitannonces.petitannoncesapp`.
2. Android Firebase project `petit-annonces-mobile` is configured: production `GOOGLE_SERVICES_JSON` is stored as an EAS secret-file variable and the FCM V1 service account is assigned in EAS.
3. Google Play upload-key reset was accepted; the new upload key becomes valid on **2026-09-14 08:32 UTC / 10:32 Europe/Paris**. Do not upload an APK/AAB before then.
4. Final post-FCM Android Production AAB is complete (`versionCode 2026091202`, Build ID `2ee074b3-27b9-410a-9d78-de36c908a7f6`); real Android push delivery, badge and notification deep-link still require physical-device / Play internal-track validation.
5. iOS is intentionally deferred while the Apple Developer account is suspended; exact Bundle ID for App Store Connect App ID `6759097498` remains unconfirmed.

Fallback warning: the Linux host has OpenJDK 17 but no Android SDK. This does not block EAS Build; it only means there is no local Android signed-build fallback.

## Automated readiness command
From `apps/mobile`:

```bash
pnpm release:readiness
```

It checks TypeScript, ESLint, Expo Doctor, managed Expo cleanliness, Dev/Preview/Production identities and schemes, live health/legal/account-deletion URLs, bridge `noindex`, production Store icons, EAS auth/projectId, explicit Store-identity confirmation, local Android toolchain availability and (when readable) production external-billing flags.

For CI/release gating, use:

```bash
RELEASE_STRICT=1 pnpm release:readiness
```

## Physical-device E2E checklist
Run first on Development, then repeat the release-critical paths on Preview.

| Area | Required test | Current |
|---|---|---|
| Auth | Register, verification bridge, login, logout, password reset, 2FA | BLOCKED: signed device build |
| Secure session | Relaunch app, resume session, revoke other sessions | BLOCKED |
| Camera/gallery | Camera, multi-photo gallery, upload/remove photo, publish draft | BLOCKED |
| Push | Permission, token registration, foreground/background notification, badge, tap deep-link | CONFIG PASS: Firebase/FCM V1; physical-device validation pending |
| Deep links | Dev/Preview scheme opens correct app; message/listing/order/search/profile/store links | BLOCKED: signed device build |
| Messages/offers | Conversation, attachments, offer/counter-offer/accept/reject | BLOCKED |
| Marketplace purchase | Address, Sendcloud option/relay, physical-goods checkout, return to order | BLOCKED; do not use real card until test account/provider mode is confirmed |
| Orders | Tracking, buyer confirmation, return/dispute, review, seller +10-day payout display | BLOCKED |
| Vacances | Availability, reservation, accepted deposit checkout, return to reservation | BLOCKED |
| Seller | Create/edit listing, status changes, free renewal | BLOCKED |
| Digital Store policy | PA credit purchase, paid renewal, boost and Pro external Stripe remain unavailable in Store build | CONFIG PASS; device verify later |
| Pro | Profile/company/store, analytics, import/feed, bulk listings | BLOCKED |
| Background | Kill/resume, network loss/recovery, Stripe browser return, notification cold start | BLOCKED |

## Remaining release sequence
1. Complete the post-FCM Android production build and archive its Build ID, AAB and checksum.
2. After 2026-09-14 10:32 Europe/Paris, upload the new AAB to Google Play internal testing using the reset upload key.
3. Install from Google Play internal testing and complete the Android E2E matrix, especially push permission/token, badge and notification-to-message deep-link.
4. Keep `NATIVE_EXTERNAL_DIGITAL_BILLING_ENABLED` and `NATIVE_EXTERNAL_PRO_BILLING_ENABLED` disabled until the applicable Store billing entitlement/program or an IAP implementation is approved.
5. Promote the tested Android build only after the E2E failures are clear.
6. When Apple Developer access returns, verify the exact iOS Bundle ID for App Store Connect App ID `6759097498`, configure APNs, build/test iOS, then submit separately.

## Expo account
- Expo account owner: `petitannon`


## Expo / EAS linkage
- Expo owner: `petitannon`
- EAS project: `@petitannon/petit-annonces`
- EAS projectId: `17797b08-4168-451a-a557-248dd35ed25a`
- EAS token authentication verified on 2026-09-12.

## 2026-09-18 App Links + messaging checkpoint
- Google Play Internal Testing release `2026091824` is `completed` for `fr.petitannonces.petitannoncesapp`.
- Android verified App Links cover both `https://petitannonces.fr/*` and `https://www.petitannonces.fr/*` with `android:autoVerify="true"`.
- `assetlinks.json` now includes both the production upload certificate and the Google Play App Signing certificate used on Play-generated APKs, so Play-installed builds can pass domain verification.
- Native external URL routing covers listings, conversations, orders, support tickets, authentication/recovery, notifications and professional-account entry points; `/messages?conversation=...` opens the matching native thread.
- Native message quick replies are horizontally scrollable on narrow devices to prevent overflow.
- PWA/mobile web Messages uses the real bottom-navigation height plus `visualViewport` for keyboard-safe sizing; the messages page owns its mobile scroll viewport and is live in the green production release.
- iOS Associated Domains are present in app config and native entitlements for `petitannonces.fr` and `www.petitannonces.fr`; server-side Universal Links association still requires the exact Apple Team ID before publishing the AASA file.


## 2026-09-18 Platform parity + notification center release
- Google Play Internal Testing release `2026091825` is `completed` for `fr.petitannonces.petitannoncesapp`.
- Final AAB SHA-256: `028d73b7b9f7e77f25110e8e454105fedee624e423f99232b6710b5fc456f7c0`; JAR signature verification passed.
- Expo 57 mobile dependencies are aligned with the SDK compatibility set and `pnpm --filter @pa/mobile preflight` passes.
- Mobile TypeScript, ESLint and Expo dependency checks pass with zero errors/warnings.
- Native notification center now follows PWA behavior: unread-only current list, per-item “mark as read”, read item removal, “mark all as read”, badge reset, device push switch and category preferences.
- PWA professional features now have native Android/iOS screens for CRM, team/roles and appointments, in addition to the existing listings, promotions, analytics, imports, subscription, stores, orders, reservations and wallet screens.
- Professional PWA deep links and notification deep links route to the corresponding native screens.
- A trusted in-app PWA bridge handles Petit Annonces web routes that do not yet have a dedicated native screen, preserving feature availability and PWA presentation instead of misrouting them to search.
- Repository policy in `AGENTS.md` requires PWA/Android/iOS parity in the same engineering pass. CI now runs the mobile lint + preflight parity gate.
- Android and iOS share the Expo/React Native implementation, so the source changes above are present for both platforms. iOS Store distribution remains blocked on the Apple-side signing/account/AASA Team ID gate; do not fabricate a Team ID.


## PWA-first native shell + admin alerts checkpoint
- Google Play Internal Testing release `2026091826` is `completed` for `fr.petitannonces.petitannoncesapp`.
- Final AAB SHA-256: `fe2996c3f524174bb10ff854d46b37127964b4ad55cf7efe200e5d71114b7652`; JAR signature verification passed.
- Android and iOS visible marketplace UI now use the production PWA as the single visual/functional source through the shared native WebView shell. The native tab bar/header duplicates are not used for the normal marketplace flow.
- PWA onboarding and notification settings remain the visible UI in native apps. Their notification controls are bridged to native Expo push permission/token subscribe, status and unsubscribe behavior.
- External `petitannonces.fr`/www App Links and native notification taps open the matching PWA path inside the native shell.
- Android/iOS shared source passes mobile TypeScript + ESLint + Expo compatibility checks. Final iOS export passed with `IOS_PWA_FIRST_EXPORT_OK`.
- Admin transactional email is queued for every newly created account from standard web registration, legacy native registration, and first-time Google/Apple OAuth signup.
- Every listing that enters `PENDING` queues a transactional email to active SUPER_ADMIN/ADMIN users. Existing moderator notification remains for cases requiring manual moderation, excluding admins to avoid duplicate mail.
- Production notification worker is enabled and 7 active SUPER_ADMIN/ADMIN recipients were resolved at verification time.
- Production is healthy after deployment: active color blue, home 200, health 200.
- Google Play publisher now serializes Android Publisher edits with a process lock and retries transient 429/5xx failures when creating an edit.
