export type Category = { id: string; name: string; slug: string; domain: string; children?: Category[] };

export type ListingPromotion = { id?: string; code: string; type: string; name: string; startsAt?: string | null; endsAt?: string | null };

export type Listing = {
  id: string;
  slug: string | null;
  title: string | null;
  description?: string | null;
  priceMinor: number | null;
  currency: string;
  city: string | null;
  postalCode?: string | null;
  region?: string | null;
  publishedAt: string | null;
  imageUrl?: string | null;
  category: { id?: string; name: string; slug: string; domain: string };
  promotions?: ListingPromotion[];
  commerce?: { acceptsOffers?: boolean; securePaymentEnabled: boolean; shippingEnabled: boolean };
  sellerReputation?: { sellerName?: string | null; avatarUrl?: string | null; kind?: string; hasStore?: boolean; reviewAverage?: number | null; reviewCount?: number };
};

export type ListingDetail = Listing & {
  status?: 'PUBLISHED' | 'SOLD' | 'EXPIRED' | string;
  viewCount?: number;
  breadcrumb?: { name: string; slug: string }[];
  media: { id: string; url: string; isCover?: boolean }[];
  seller: { id: string; name: string; avatarUrl: string | null; verified: boolean; kind: string; completedSales?: number; memberSince?: string; store?: { name: string; slug: string; logoUrl?: string | null; isVerified?: boolean } | null; trust?: { score?: number; reliableSeller?: boolean; level?: string }; reputation?: unknown; reviews?: { count?: number; average?: number | null; recent?: unknown[] } };
  attributes?: { key: string; label: string; unit?: string | null; value: unknown }[];
  vehicle?: Record<string, unknown> | null;
  vehicleHistory?: { checkedAt?: string | null; firstRegistrationDate?: string | null; sraClass?: string | null; theftRiskLevel?: string | null; originalNewValueEuro?: number | null; ownerChanges?: number | null; controlledDamageCount?: number | null; administrativeStatus?: string | null; technicalInspectionDate?: string | null; technicalInspectionResult?: string | null; mileageKm?: number | null; officialHistovecUrl?: string | null } | null;
  commerce?: { acceptsOffers?: boolean; securePaymentEnabled: boolean; shippingEnabled: boolean };
};