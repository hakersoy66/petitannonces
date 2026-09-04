import { createHmac, timingSafeEqual } from "node:crypto";

export type ShippingCarrier = "MONDIAL_RELAY" | "COLISSIMO";
export type ShippingQuotePayload = {
  carrier: ShippingCarrier;
  service: string;
  amountMinor: number;
  weightG: number;
  postalCode: string;
  countryCode: string;
  expiresAt: number;
};

function secret() {
  const value = process.env.SHIPPING_QUOTE_SECRET;
  if (!value && process.env.NODE_ENV === "production") throw new Error("shipping_quote_secret_missing");
  return value ?? "petitannonces-development-shipping-quote-secret";
}

function encode(value: string) { return Buffer.from(value).toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url").toString("utf8"); }
function signature(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }

export function signShippingQuote(input: Omit<ShippingQuotePayload, "expiresAt">, ttlSeconds = 900) {
  const payload: ShippingQuotePayload = { ...input, expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

export function verifyShippingQuote(token: string): ShippingQuotePayload | null {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = signature(encoded);
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(decode(encoded)) as ShippingQuotePayload;
    if (!payload.carrier || !payload.service || !Number.isInteger(payload.amountMinor) || payload.amountMinor < 0) return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export async function getShippingQuotes(weightG: number, postalCode: string, countryCode: string) {
  const endpoint = process.env.SHIPPING_RATE_PROXY_URL;
  const token = process.env.SHIPPING_RATE_PROXY_TOKEN;
  if (endpoint && token) {
    const url = new URL(endpoint);
    url.searchParams.set("weightG", String(weightG));
    url.searchParams.set("postalCode", postalCode);
    url.searchParams.set("countryCode", countryCode);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (response.ok) {
      const data = await response.json() as { quotes?: Array<{ carrier: ShippingCarrier; service: string; amountMinor: number; label?: string; etaDays?: string }> };
      if (Array.isArray(data.quotes) && data.quotes.length) return data.quotes;
    }
  }

  const kg = Math.max(0.1, weightG / 1000);
  const mr = Math.round(399 + Math.max(0, kg - 0.5) * 85);
  const colissimo = Math.round(599 + Math.max(0, kg - 0.5) * 135);
  return [
    { carrier: "MONDIAL_RELAY" as const, service: "POINT_RELAIS", amountMinor: mr, label: "Mondial Relay · Point Relais", etaDays: "3–5 jours" },
    { carrier: "COLISSIMO" as const, service: "DOM", amountMinor: colissimo, label: "Colissimo · Domicile", etaDays: "2–3 jours" },
  ];
}
