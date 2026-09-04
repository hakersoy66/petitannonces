import { createHmac, timingSafeEqual } from "node:crypto";

export type ShippingQuotePayload = {
  provider: "SENDCLOUD";
  shippingOptionCode: string;
  carrierCode: string;
  carrierName: string;
  serviceName: string;
  amountMinor: number;
  currency: string;
  servicePoint: boolean;
  contractId?: number;
  weightG: number;
  recipientPostalCode: string;
  recipientCountryCode: string;
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
    if (payload.provider !== "SENDCLOUD" || !payload.shippingOptionCode || !payload.carrierCode || !payload.serviceName) return null;
    if (!Number.isInteger(payload.amountMinor) || payload.amountMinor < 0 || !Number.isInteger(payload.weightG) || payload.weightG < 50) return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
