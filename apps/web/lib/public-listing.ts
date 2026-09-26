import { cache } from "react";

export type PublicListingDetail = {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  status: "PUBLISHED" | "SOLD" | "EXPIRED";
  updatedAt: string;
  viewCount: number;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  publishedAt: string | null;
  expiresAt: string | null;
  category: { id: string; name: string; slug: string; domain: "GENERAL" | "VEHICLE" | "REAL_ESTATE" | "JOB" | "SERVICE" | "ANIMAL" };
  breadcrumb: Array<{ name: string; slug: string }>;
  attributes: Array<{ key: string; label: string; unit: string | null; value: unknown }>;
  media: Array<{ id: string; url: string; mimeType: string; width: number | null; height: number | null; altText: string | null; isCover: boolean }>;
  vehicle: Record<string, unknown> | null;
  vehicleHistory: { checkedAt:string|null; firstRegistrationDate:string|null; sraClass:string|null; theftRiskLevel:string|null; originalNewValueEuro:number|null; ownerChanges:number|null; controlledDamageCount:number|null; administrativeStatus:string|null; technicalInspectionDate:string|null; technicalInspectionResult:string|null; mileageKm:number|null; officialHistovecUrl:string|null } | null;
  property: Record<string, unknown> | null;
  energy: Record<string, unknown> | null;
  productSafety: { manufacturerName:string|null; manufacturerPostalAddress:string|null; manufacturerEmail:string|null; responsiblePersonName:string|null; responsiblePersonPostalAddress:string|null; responsiblePersonEmail:string|null; productIdentifier:string|null; model:string|null; ean:string|null; ceMarked:boolean|null; safetyWarning:string|null } | null;
  consumerDisclosure: { sellerIsTrader:boolean; withdrawalRightApplies:boolean|null; withdrawalPeriodDays:number|null; withdrawalExceptionCode:string|null } | null;
  commerce: { acceptsOffers: boolean; securePaymentEnabled: boolean; handDeliveryEnabled:boolean; mondialRelayEnabled:boolean; colissimoEnabled:boolean; shippingEnabled: boolean };
  promotions: Array<{ id:string; code:string; type:string; name:string; startsAt:string|null; endsAt:string|null }>;
  priceHistory: Array<{ oldPriceMinor:number; newPriceMinor:number; currency:string; changedAt:string }>;
  seller: {
    id: string;
    kind: "PARTICULIER" | "PROFESSIONNEL";
    name: string;
    siretVerified: boolean;
    professionalSector: "AUTOMOBILE" | "IMMOBILIER" | "COMMERCE" | "VACANCES" | "SERVICES" | "GENERAL" | null;
    appointmentBookingEnabled: boolean;
    avatarUrl: string | null;
    memberSince: string;
    verified: boolean;
    phoneVerified: boolean;
    paymentReady: boolean;
    store: { id:string; name: string; slug: string; logoUrl: string | null; isVerified: boolean } | null;
    completedSales: number;
    trust: { score: number; reliableSeller: boolean; level: "NEW" | "ESTABLISHED" | "TRUSTED" };
    reputation?: { badges:Array<{code:string;label:string;shortLabel:string;description:string;icon:"shield"|"bolt"|"circle-check"|"truck"|"star";priority:number}>; cardBadges:Array<{code:string;label:string;shortLabel:string;description:string;icon:"shield"|"bolt"|"circle-check"|"truck"|"star";priority:number}>; metrics:{reviewCount:number;reviewAverage:number|null;completedSales:number;cancellationRate:number;disputeRate:number;responseSamples:number;responseWithinTwoHoursRate:number;averageResponseMinutes:number|null;shipmentSamples:number;shipmentWithin48HoursRate:number} } | null;
    reviews: { count: number; average: number | null; recent: Array<{ id: string; rating: number; comment: string | null; createdAt: string; reviewerName: string }> };
  };
};

export const fetchPublicListing = cache(async (slug: string): Promise<PublicListingDetail | null> => {
  const normalizedSlug=String(slug??"").trim();
  if(!normalizedSlug||normalizedSlug==="null"||normalizedSlug==="undefined")return null;
  const baseUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/public/listings/${encodeURIComponent(normalizedSlug)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`listing_api_${response.status}`);
  const payload = await response.json() as { listing: PublicListingDetail };
  return payload.listing;
});

export function formatMoney(amountMinor: number | null, currency = "EUR") {
  if (amountMinor === null) return "Prix sur demande";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100);
}

export function attributeToText(value: unknown, unit?: string | null) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (value === null || value === undefined || value === "") return "—";
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}


export type SimilarListing = {
  id: string;
  slug: string | null;
  title: string | null;
  priceMinor: number | null;
  currency: string;
  status: "PUBLISHED" | "SOLD" | "EXPIRED";
  updatedAt: string;
  city: string | null;
  imageUrl: string | null;
  vehicle?: Record<string, unknown> | null;
  property?: Record<string, unknown> | null;
  category?: { name: string; slug: string; domain: string };
  promotions?: Array<{ code:string; type:string; name:string; endsAt?:string|null }>;
  commerce?: { securePaymentEnabled?:boolean; shippingEnabled?:boolean };
  sellerReputation?: { verified?:boolean;kind?:string;hasStore?:boolean;paymentReady?:boolean;avatarUrl?:string|null;sellerName?:string|null;reviewCount?:number;reviewAverage?:number|null;trust?:{reliableSeller?:boolean};cardBadges?:Array<{code:string;label:string;shortLabel:string;description:string;icon:"shield"|"bolt"|"circle-check"|"truck"|"star"}> };
};

export async function fetchSimilarListings(categorySlug: string, excludeId: string): Promise<SimilarListing[]> {
  const baseUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/search?category=${encodeURIComponent(categorySlug)}&limit=8`, { next: { revalidate: 120 } });
    if (!response.ok) return [];
    const payload = await response.json() as { items?: SimilarListing[] };
    return (payload.items ?? []).filter((item) => item.id !== excludeId && item.slug).slice(0, 3);
  } catch { return []; }
}
