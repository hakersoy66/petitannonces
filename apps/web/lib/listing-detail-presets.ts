export type ListingDetailVariant = "PRODUCT" | "VEHICLE" | "REAL_ESTATE";

export interface ListingSpec {
  label: string;
  value: string;
}

export interface ListingDetailPreset {
  variant: ListingDetailVariant;
  breadcrumb: string[];
  price: string;
  seller: string;
  location: string;
  meta: string[];
  specs: ListingSpec[];
  description: string;
  trustTitle: string;
  trustText: string;
  primaryCta: string;
  secondaryCta: string;
  tertiaryCta?: string;
  extraSection?: {
    title: string;
    items: Array<{ label: string; value: string }>;
  };
}

const productPreset: ListingDetailPreset = {
  variant: "PRODUCT",
  breadcrumb: ["High-tech", "Téléphones"],
  price: "799 €",
  seller: "Hakan E.",
  location: "Saint-Étienne (42000)",
  meta: ["Publiée aujourd’hui", "128 vues"],
  specs: [
    { label: "État", value: "Très bon état" },
    { label: "Marque", value: "Apple" },
    { label: "Modèle", value: "iPhone 15 Pro" },
    { label: "Stockage", value: "256 Go" },
    { label: "Couleur", value: "Titane naturel" },
    { label: "Garantie", value: "Oui" },
  ],
  description: "Article en excellent état, toujours protégé et soigneusement utilisé. Vendu avec ses accessoires d’origine. Remise en main propre possible ou expédition via la livraison sécurisée Petit Annonces.",
  trustTitle: "Paiement sécurisé Petit Annonces",
  trustText: "Votre paiement est protégé jusqu’à la bonne réception de l’article lorsque la transaction sécurisée est utilisée.",
  primaryCta: "Acheter en toute sécurité",
  secondaryCta: "Contacter le vendeur",
  tertiaryCta: "Faire une offre",
  extraSection: {
    title: "Livraison",
    items: [
      { label: "Remise en main propre", value: "Disponible" },
      { label: "Mondial Relay", value: "À partir de 4,49 €" },
      { label: "Colissimo", value: "À partir de 6,99 €" },
    ],
  },
};

const vehiclePreset: ListingDetailPreset = {
  variant: "VEHICLE",
  breadcrumb: ["Véhicules", "Voitures"],
  price: "13 900 €",
  seller: "Julien M.",
  location: "Lyon 69003",
  meta: ["Publiée aujourd’hui", "1 256 vues"],
  specs: [
    { label: "Année", value: "2021" },
    { label: "Kilométrage", value: "38 500 km" },
    { label: "Carburant", value: "Essence" },
    { label: "Boîte", value: "Manuelle" },
    { label: "Puissance", value: "90 ch (66 kW)" },
    { label: "Crit’Air", value: "Crit’Air 1" },
  ],
  description: "Véhicule entretenu, non-fumeur et en excellent état général. Historique d’entretien disponible. Équipements : écran tactile, Apple CarPlay / Android Auto, climatisation, régulateur, aide au stationnement et caméra de recul.",
  trustTitle: "Achat véhicule en confiance",
  trustText: "Le vendeur peut transmettre les justificatifs du véhicule et les informations techniques vérifiées disponibles sur Petit Annonces.",
  primaryCta: "Contacter le vendeur",
  secondaryCta: "Faire une offre",
  tertiaryCta: "Demander les documents",
  extraSection: {
    title: "Informations véhicule",
    items: [
      { label: "Première mise en circulation", value: "05/2021" },
      { label: "Puissance fiscale", value: "5 CV" },
      { label: "Émissions CO₂", value: "119 g/km" },
      { label: "Garantie", value: "6 mois" },
    ],
  },
};

const realEstatePreset: ListingDetailPreset = {
  variant: "REAL_ESTATE",
  breadcrumb: ["Immobilier", "Vente"],
  price: "249 000 €",
  seller: "Agence Loire Habitat",
  location: "Saint-Étienne (42100)",
  meta: ["Publiée hier", "842 vues"],
  specs: [
    { label: "Type", value: "Appartement" },
    { label: "Surface", value: "82 m²" },
    { label: "Pièces", value: "4" },
    { label: "Chambres", value: "3" },
    { label: "Étage", value: "3 / 5" },
    { label: "Chauffage", value: "Gaz individuel" },
  ],
  description: "Appartement lumineux de 82 m² avec trois chambres, séjour traversant, cuisine équipée et balcon. Immeuble entretenu avec ascenseur. Proche transports, écoles et commerces.",
  trustTitle: "Informations immobilières en France",
  trustText: "Les informations DPE, GES et estimations de dépenses énergétiques sont affichées dans le détail du bien lorsqu’elles sont requises.",
  primaryCta: "Contacter l’annonceur",
  secondaryCta: "Demander une visite",
  tertiaryCta: "Voir le téléphone",
  extraSection: {
    title: "Diagnostic énergétique",
    items: [
      { label: "DPE", value: "C · 142 kWh/m²/an" },
      { label: "GES", value: "C · 28 kg CO₂/m²/an" },
      { label: "Dépenses estimées", value: "980 € à 1 360 € / an" },
      { label: "Année de référence", value: "2021" },
    ],
  },
};

export function getListingDetailPreset(slug: string): ListingDetailPreset {
  const value = slug.toLowerCase();
  if (["renault", "peugeot", "citroen", "citroën", "dacia", "tesla", "clio", "voiture", "auto", "bmw", "mercedes", "audi"].some((token) => value.includes(token))) return vehiclePreset;
  if (["appartement", "maison", "immobilier", "studio", "terrain", "villa", "duplex"].some((token) => value.includes(token))) return realEstatePreset;
  return productPreset;
}
