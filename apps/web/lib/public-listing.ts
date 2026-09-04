export type PublicListingDetail = {
  id: string;
  slug: string | null;
  title: string | null;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  city: string | null;
  postalCode: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  publishedAt: string | null;
  category: { id: string; name: string; slug: string; domain: "GENERAL" | "VEHICLE" | "REAL_ESTATE" | "JOB" | "SERVICE" | "ANIMAL" };
  breadcrumb: Array<{ name: string; slug: string }>;
  attributes: Array<{ key: string; label: string; unit: string | null; value: unknown }>;
  media: Array<{ id: string; url: string; mimeType: string; width: number | null; height: number | null; altText: string | null; isCover: boolean }>;
  vehicle: Record<string, unknown> | null;
  property: Record<string, unknown> | null;
  energy: Record<string, unknown> | null;
  commerce: { securePaymentEnabled: boolean; shippingEnabled: boolean };
  seller: {
    id: string;
    kind: "PARTICULIER" | "PROFESSIONNEL";
    name: string;
    avatarUrl: string | null;
    memberSince: string;
    verified: boolean;
    store: { name: string; slug: string; logoUrl: string | null; isVerified: boolean } | null;
  };
};

export async function fetchPublicListing(slug: string): Promise<PublicListingDetail | null> {
  const baseUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/public/listings/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`listing_api_${response.status}`);
  const payload = await response.json() as { listing: PublicListingDetail };
  return payload.listing;
}

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
