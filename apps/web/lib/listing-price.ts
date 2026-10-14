export type ListingPriceContext = {
  domain?: string | null;
  transactionType?: string | null;
  isVacation?: boolean;
  categorySlug?: string | null;
};

export type ListingPriceBasis = "TOTAL" | "MONTH" | "HOUR" | "NIGHT";

export function listingPriceBasis(context: ListingPriceContext): ListingPriceBasis {
  if (context.isVacation) return "NIGHT";
  if (context.domain === "REAL_ESTATE" && context.transactionType === "RENTAL") return "MONTH";
  if (context.domain === "JOB") return "HOUR";
  return "TOTAL";
}

export function listingPriceCopy(context: ListingPriceContext) {
  const basis = listingPriceBasis(context);
  if (basis === "NIGHT") return { basis, label: "Prix par nuit", shortLabel: "Par nuit", suffix: " / nuit", inputSuffix: "€ / nuit", placeholder: "85", help: "Indiquez le tarif pour une nuit. Le voyageur verra le coût estimé selon ses dates." };
  if (basis === "MONTH") return { basis, label: "Loyer mensuel", shortLabel: "Loyer", suffix: " / mois", inputSuffix: "€ / mois", placeholder: "700", help: "Indiquez le loyer demandé chaque mois." };
  if (basis === "HOUR") return { basis, label: "Rémunération horaire", shortLabel: "Taux horaire", suffix: " / heure", inputSuffix: "€ / heure", placeholder: "12,50", help: "Indiquez la rémunération proposée pour une heure de travail." };
  if (context.domain === "REAL_ESTATE") return { basis, label: "Prix de vente", shortLabel: "Prix", suffix: "", inputSuffix: "€", placeholder: "180000", help: "Indiquez le prix de vente demandé pour le bien." };
  if (context.categorySlug === "location-vehicules") return { basis, label: "Tarif de location (facultatif)", shortLabel: "Location", suffix: "", inputSuffix: "€", placeholder: "49", help: "Indiquez le prix correspondant à la formule choisie (jour, semaine ou mois). Laissez vide pour un devis sur demande." };
  if (context.categorySlug === "transfert-vip") return { basis, label: "Tarif du transfert (facultatif)", shortLabel: "Transfert", suffix: "", inputSuffix: "€", placeholder: "80", help: "Indiquez le tarif pour un trajet, une heure ou un forfait selon la formule choisie. Laissez vide pour un devis personnalisé." };
  if (context.domain === "SERVICE") return { basis, label: "Tarif du service (facultatif)", shortLabel: "Tarif", suffix: "", inputSuffix: "€", placeholder: "50", help: "Laissez vide pour afficher « Prix sur demande », ou indiquez un tarif fixe." };
  return { basis, label: "Prix de l’annonce", shortLabel: "Prix", suffix: "", inputSuffix: "€", placeholder: "120", help: "Indiquez le montant demandé pour cette annonce." };
}

export function formatListingPrice(amountMinor: number | null, currency = "EUR", context: ListingPriceContext = {}, empty = "Prix sur demande") {
  if (amountMinor === null) return empty;
  if (amountMinor === 0 && listingPriceCopy(context).basis === "TOTAL") return "Gratuit";
  const amount = new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100);
  return `${amount}${listingPriceCopy(context).suffix}`;
}
