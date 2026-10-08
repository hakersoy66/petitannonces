/**
 * Keep policyVersion stable across purely visual consent-banner releases: visitors
 * with a still-valid decision must not be asked again because UI changed.
 */
export const COOKIE_STORAGE_KEY="pa_cookie_consent_v1";
export const COOKIE_POLICY_VERSION="2026-09-meta";
export const COOKIE_CONSENT_TTL_MS=180*24*60*60*1000;
export type CookieChoices={analytics:boolean;personalization:boolean;advertising:boolean};
export type StoredCookieConsent=CookieChoices&{policyVersion?:string;savedAt?:string};

export const COOKIE_REJECT_ALL:CookieChoices={analytics:false,personalization:false,advertising:false};
export const COOKIE_ACCEPT_ALL:CookieChoices={analytics:true,personalization:true,advertising:true};

export function cookieDecisionValid(input:unknown,now=Date.now()):input is StoredCookieConsent{
 if(!input||typeof input!=="object")return false;
 const consent=input as Partial<StoredCookieConsent>;
 const timestamp=typeof consent.savedAt==="string"?Date.parse(consent.savedAt):NaN;
 return consent.policyVersion===COOKIE_POLICY_VERSION
  && Number.isFinite(timestamp)
  && now>=timestamp
  && now-timestamp<COOKIE_CONSENT_TTL_MS
  && typeof consent.analytics==="boolean"
  && typeof consent.personalization==="boolean"
  && typeof consent.advertising==="boolean";
}
