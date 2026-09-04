export type UserKind = "PARTICULIER" | "PROFESSIONNEL";
export type ListingStatus = "DRAFT" | "PENDING" | "PUBLISHED" | "SUSPENDED" | "SOLD" | "EXPIRED";
export type ClientPlatform = "WEB" | "IOS" | "ANDROID";

export interface Money {
  amountMinor: number;
  currency: "EUR";
}

export interface PushSubscriptionInput {
  platform: ClientPlatform;
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
  nativeToken?: string;
  deviceLabel?: string;
}

export interface NotificationPreferences {
  messages: boolean;
  offers: boolean;
  orders: boolean;
  promotions: boolean;
  savedSearches: boolean;
  security: boolean;
}

export interface MobileApiEnvelope<T> {
  data: T;
  requestId?: string;
}

export * from "./catalog.js";
