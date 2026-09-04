export type UserKind = "PARTICULIER" | "PROFESSIONNEL";
export type ListingStatus = "DRAFT" | "PENDING" | "PUBLISHED" | "SUSPENDED" | "SOLD" | "EXPIRED";

export interface Money {
  amountMinor: number;
  currency: "EUR";
}
