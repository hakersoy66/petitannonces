# Petit Annonces native release candidate — 2026-09-12

## Candidate
- App version: 1.0.0
- iOS bundle candidate: `fr.petitannonces.app`
- Android package confirmed in Google Play Console: `fr.petitannonces.petitannoncesapp`
- Production scheme: `petitannonces`
- API: `https://petitannonces.fr/api`
- Account deletion URL: `https://petitannonces.fr/supprimer-mon-compte`
- iPad support retained for compatibility with the existing App Store record; iPad screenshots/device validation are required before submission.

## Automated verification
- Mobile ESLint: PASS, 0 findings
- Mobile TypeScript: PASS
- Expo Doctor: PASS 21/21
- Android production Expo export: PASS, 29 files, ~4.5 MB
- iOS production Expo export: PASS, 25 files, ~3.3 MB
- Live health/legal/support/account-deletion URLs: PASS
- Payment return bridges: PASS `noindex` checks
- Native external digital billing: disabled/unset
- Native external Pro billing: disabled/unset
- Google Play target API: PASS — React Native 0.86.3 resolves `compileSdk=36`, `targetSdk=36` (required for submissions after 31 Aug 2026).

## Release artifact integrity
- Android Hermes bundle SHA-256: `3f44cfc0eafa5a9d2ee8e1b9a31ee40037d354ab338f5d16330841a6e172684b`
- iOS Hermes bundle SHA-256: `c51fed7fdd02b3f75ecd47a1093547d1aef888220efffb49376ee410663b94ec`
- iOS Store icon SHA-256: `3d5b4bc661db175e2664e6aec67b2845a5f5e940bb956369a10131ba05d51f75`
- Android adaptive icon SHA-256: `e4d1e7ca1bc94a54e60885e163550bdc9fba429eca5f6d702f2a66934a2bc654`

## Local / EAS release automation
- OpenJDK 17 installed on the production workspace and verified.
- `scripts/setup-local-android-sdk.sh` prepares Android SDK API 36 + Build Tools 35.0.0, but intentionally refuses to continue until the account owner explicitly accepts Google Android SDK terms via `PA_ANDROID_SDK_LICENSE_ACCEPTED=true`.
- `scripts/mobile-eas-release.sh preview` runs quality checks then requests signed Preview builds for both platforms.
- `scripts/mobile-eas-release.sh production-build` requires strict readiness and explicit Store identity confirmation.
- `scripts/mobile-eas-release.sh submit` additionally requires `PA_RELEASE_SUBMIT_CONFIRMED=true` before sending the latest signed builds to the stores.

## Existing Store identity evidence
- Apple App Store Connect record is known: App ID `6759097498` (Petit Annonces, Hakan Ersoy). The exact iOS bundle identifier must still be read from App Store Connect before production build; `fr.petitannonces.app` is only a local placeholder/default and must not be treated as confirmed.
- Known Google Play record 1: `fr.petitannonces` — original Flynax key, production access granted March 2026.
- Known Google Play record 2: `fr.petitannonces.petitannoncesapp` — later tested record, production access granted April 2026; subsequent privacy-policy compliance notice was received.
- `fr.petitannonces.app` is not one of the known existing Google Play package IDs and must not be used for production unless intentionally creating a new listing.
- Production release requires explicit `PA_IOS_BUNDLE_ID` and `PA_ANDROID_PACKAGE`; strict preflight rejects guessed/default Store identities.
- App Store submission profile is pinned to existing App Store Connect App ID `6759097498`; iOS Preview/Production EAS image is pinned to `sdk-57` (Xcode 26.6 family).

## External release gates
1. Android package is confirmed as `fr.petitannonces.petitannoncesapp`; Firebase project `petit-annonces-mobile` and FCM V1 are configured in EAS.
2. Google Play upload-key reset is accepted; the new key becomes valid on 2026-09-14 08:32 UTC / 10:32 Europe/Paris, so Play upload is blocked until then.
3. The pre-FCM production AAB (`versionCode 2026091201`) is quarantined and must not be uploaded.
4. Produce the post-FCM signed Android Production build, then validate it through Google Play internal testing before production promotion.
5. iOS remains deferred until Apple Developer access returns and the exact Bundle ID is verified in App Store Connect.

No Store credentials or secrets belong in this repository.

## Store identity confirmation
- Google Play package confirmed by the account owner on 2026-09-12: `fr.petitannonces.petitannoncesapp`.
- iOS Bundle ID still requires App Store Connect verification for Apple App ID `6759097498`.

## Expo account
- Expo account owner: `petitannon`


## Expo / EAS linkage
- Expo owner: `petitannon`
- EAS project: `@petitannon/petit-annonces`
- EAS projectId: `17797b08-4168-451a-a557-248dd35ed25a`
- EAS token authentication verified on 2026-09-12.


## EAS Android Preview
- Build ID: `4ffafb69-802e-47e9-b496-c168d61fdf3e`
- Profile: `preview` / internal distribution
- App identifier: `fr.petitannonces.petitannoncesapp.preview`
- SDK: `57.0.0`
- App version/build: `1.0.0` / `1`
- EAS remote Android keystore: created successfully.
## Android Production · post-FCM final build
- Build ID: `2ee074b3-27b9-410a-9d78-de36c908a7f6`
- Profile: `production` / Store
- App identifier: `fr.petitannonces.petitannoncesapp`
- App version: `1.0.0`
- versionCode: `2026091202`
- EAS status: `FINISHED`
- Firebase project: `petit-annonces-mobile`
- FCM V1: configured in EAS
- Final AAB: `/var/www/petitannonces/shared/android-release/petitannonces-1.0.0-2026091202-FINAL-FCM.aab`
- AAB size: `73089427` bytes
- AAB SHA-256: `298bb437ed6256e9994a4d576e1501ebae14e6bd7526756bc5ea160cd2fcd6e2`
- Signing SHA-1: `A6:B2:FB:09:6C:3B:D3:80:3C:F5:E5:67:79:12:82:64:57:87:2F:22`
- Signing SHA-256: `D8:6C:7F:EF:BB:EA:63:A4:19:A3:23:76:89:4D:46:64:B9:A9:D9:CD:D8:17:7A:3E:E9:E2:37:5E:AE:02:9B:47`
- Archive integrity: PASS
- Firebase resource markers in AAB: `google_app_id`, `gcm_defaultSenderId`, `firebase_database_url`
- The signing certificate matches the upload key approved in the Google Play reset request.
- Do not upload before `2026-09-14 08:32 UTC / 10:32 Europe/Paris`.

