export type CategoryDomain = "GENERAL" | "VEHICLE" | "REAL_ESTATE" | "JOB" | "SERVICE" | "ANIMAL";
export type CatalogFieldType = "TEXT" | "NUMBER" | "BOOLEAN" | "SELECT" | "MULTISELECT" | "DATE";

export interface CatalogFilter {
  key: string;
  label: string;
  type: CatalogFieldType;
  required?: boolean;
  unit?: string;
  options?: string[];
  group?: "identity" | "specs" | "condition" | "delivery" | "legal" | "energy" | "job";
}

export interface CatalogCategory {
  name: string;
  slug: string;
  icon?: string;
  domain: CategoryDomain;
  description?: string;
  filters?: CatalogFilter[];
  children?: CatalogCategory[];
}

const condition = ["Neuf", "Comme neuf", "Très bon état", "Bon état", "État correct", "À réparer"];
const yesNo = ["Oui", "Non"];

const vehicleBase: CatalogFilter[] = [
  { key: "brand", label: "Marque", type: "TEXT", required: true, group: "identity" },
  { key: "model", label: "Modèle", type: "TEXT", required: true, group: "identity" },
  { key: "firstRegistration", label: "Mise en circulation", type: "DATE", group: "identity" },
  { key: "mileage", label: "Kilométrage", type: "NUMBER", unit: "km", required: true, group: "specs" },
  { key: "fuel", label: "Énergie", type: "SELECT", options: ["Essence", "Diesel", "Hybride", "Hybride rechargeable", "Électrique", "GPL", "E85", "Autre"], group: "specs" },
  { key: "gearbox", label: "Boîte de vitesse", type: "SELECT", options: ["Manuelle", "Automatique"], group: "specs" },
  { key: "fiscalPower", label: "Puissance fiscale", type: "NUMBER", unit: "CV", group: "specs" },
  { key: "powerKw", label: "Puissance", type: "NUMBER", unit: "kW", group: "specs" },
  { key: "doors", label: "Nombre de portes", type: "SELECT", options: ["2", "3", "4", "5", "6+"], group: "specs" },
  { key: "seats", label: "Nombre de places", type: "NUMBER", group: "specs" },
  { key: "color", label: "Couleur", type: "TEXT", group: "condition" },
  { key: "condition", label: "État", type: "SELECT", options: condition, group: "condition" },
  { key: "critAir", label: "Crit'Air", type: "SELECT", options: ["0", "1", "2", "3", "4", "5", "Non classé"], group: "legal" },
  { key: "warranty", label: "Sous garantie", type: "BOOLEAN", group: "condition" },
];

const techBase: CatalogFilter[] = [
  { key: "brand", label: "Marque", type: "TEXT", group: "identity" },
  { key: "model", label: "Modèle", type: "TEXT", group: "identity" },
  { key: "condition", label: "État", type: "SELECT", required: true, options: condition, group: "condition" },
  { key: "storage", label: "Stockage", type: "SELECT", options: ["32 Go", "64 Go", "128 Go", "256 Go", "512 Go", "1 To", "2 To+"] , group: "specs" },
  { key: "ram", label: "Mémoire RAM", type: "SELECT", options: ["4 Go", "8 Go", "12 Go", "16 Go", "24 Go", "32 Go", "64 Go+"] , group: "specs" },
  { key: "color", label: "Couleur", type: "TEXT", group: "condition" },
  { key: "warranty", label: "Garantie", type: "BOOLEAN", group: "condition" },
];

const propertyBase: CatalogFilter[] = [
  { key: "propertyType", label: "Type de bien", type: "SELECT", required: true, options: ["Appartement", "Maison", "Terrain", "Parking", "Local commercial", "Bureau", "Immeuble", "Autre"] },
  { key: "surface", label: "Surface habitable", type: "NUMBER", unit: "m²", required: true },
  { key: "rooms", label: "Nombre de pièces", type: "NUMBER", required: true },
  { key: "bedrooms", label: "Chambres", type: "NUMBER" },
  { key: "floor", label: "Étage", type: "NUMBER" },
  { key: "elevator", label: "Ascenseur", type: "BOOLEAN" },
  { key: "furnished", label: "Meublé", type: "BOOLEAN" },
  { key: "parking", label: "Stationnement", type: "BOOLEAN" },
  { key: "outdoor", label: "Extérieur", type: "MULTISELECT", options: ["Balcon", "Terrasse", "Jardin", "Piscine"] },
  { key: "heating", label: "Chauffage", type: "SELECT", options: ["Électrique", "Gaz", "Fioul", "Bois", "Pompe à chaleur", "Collectif", "Autre"] },
  { key: "dpe", label: "Classe énergie DPE", type: "SELECT", options: ["A", "B", "C", "D", "E", "F", "G"], group: "energy" },
  { key: "ges", label: "Classe climat GES", type: "SELECT", options: ["A", "B", "C", "D", "E", "F", "G"], group: "energy" },
];

export const catalog: CatalogCategory[] = [
  {
    name: "Véhicules", slug: "vehicules", icon: "🚗", domain: "VEHICLE", description: "Auto, moto, utilitaires et mobilité",
    children: [
      { name: "Voitures", slug: "voitures", domain: "VEHICLE", filters: vehicleBase },
      { name: "Motos", slug: "motos", domain: "VEHICLE", filters: [...vehicleBase, { key: "engineSize", label: "Cylindrée", type: "NUMBER", unit: "cm³" }] },
      { name: "Scooters", slug: "scooters", domain: "VEHICLE", filters: vehicleBase },
      { name: "Utilitaires", slug: "utilitaires", domain: "VEHICLE", filters: [...vehicleBase, { key: "payload", label: "Charge utile", type: "NUMBER", unit: "kg" }] },
      { name: "Camping-cars & caravanes", slug: "camping-cars-caravanes", domain: "VEHICLE", filters: [...vehicleBase, { key: "sleepingPlaces", label: "Couchages", type: "NUMBER" }] },
      { name: "Nautisme", slug: "nautisme", domain: "VEHICLE", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "length", label: "Longueur", type: "NUMBER", unit: "m" }, { key: "engineHours", label: "Heures moteur", type: "NUMBER", unit: "h" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Pièces & accessoires auto", slug: "pieces-accessoires-auto", domain: "GENERAL", filters: [{ key: "partType", label: "Type de pièce", type: "SELECT", options: ["Moteur", "Freinage", "Carrosserie", "Éclairage", "Pneus & jantes", "Électronique", "Intérieur", "Autre"] }, { key: "brand", label: "Marque compatible", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Immobilier", slug: "immobilier", icon: "🏠", domain: "REAL_ESTATE", description: "Vente, location et immobilier professionnel",
    children: [
      { name: "Vente", slug: "vente-immobilier", domain: "REAL_ESTATE", filters: propertyBase },
      { name: "Location", slug: "location-immobilier", domain: "REAL_ESTATE", filters: [...propertyBase, { key: "charges", label: "Charges mensuelles", type: "NUMBER", unit: "€" }, { key: "deposit", label: "Dépôt de garantie", type: "NUMBER", unit: "€" }] },
      { name: "Colocation", slug: "colocation", domain: "REAL_ESTATE", filters: propertyBase },
      { name: "Locations saisonnières", slug: "locations-saisonnieres", domain: "REAL_ESTATE", filters: [...propertyBase, { key: "capacity", label: "Capacité", type: "NUMBER", unit: "personnes" }] },
      { name: "Bureaux & commerces", slug: "bureaux-commerces", domain: "REAL_ESTATE", filters: propertyBase },
      { name: "Terrains", slug: "terrains", domain: "REAL_ESTATE", filters: [{ key: "surface", label: "Surface", type: "NUMBER", unit: "m²", required: true }, { key: "buildable", label: "Constructible", type: "BOOLEAN" }, { key: "serviced", label: "Viabilisé", type: "BOOLEAN" }] },
      { name: "Parkings & garages", slug: "parkings-garages", domain: "REAL_ESTATE", filters: [{ key: "type", label: "Type", type: "SELECT", options: ["Parking", "Box", "Garage"] }, { key: "covered", label: "Couvert", type: "BOOLEAN" }, { key: "secured", label: "Sécurisé", type: "BOOLEAN" }] },
    ]
  },
  {
    name: "High-tech", slug: "high-tech", icon: "💻", domain: "GENERAL",
    children: [
      { name: "Téléphones & smartphones", slug: "telephones-smartphones", domain: "GENERAL", filters: [...techBase, { key: "screenSize", label: "Taille écran", type: "NUMBER", unit: "pouces" }, { key: "dualSim", label: "Double SIM", type: "BOOLEAN" }] },
      { name: "Ordinateurs portables", slug: "ordinateurs-portables", domain: "GENERAL", filters: [...techBase, { key: "processor", label: "Processeur", type: "TEXT" }, { key: "screenSize", label: "Écran", type: "NUMBER", unit: "pouces" }, { key: "gpu", label: "Carte graphique", type: "TEXT" }] },
      { name: "PC & composants", slug: "pc-composants", domain: "GENERAL", filters: techBase },
      { name: "Tablettes & liseuses", slug: "tablettes-liseuses", domain: "GENERAL", filters: techBase },
      { name: "TV & home cinéma", slug: "tv-home-cinema", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "screenSize", label: "Diagonale", type: "NUMBER", unit: "pouces" }, { key: "resolution", label: "Résolution", type: "SELECT", options: ["HD", "Full HD", "4K UHD", "8K"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Jeux vidéo & consoles", slug: "jeux-video-consoles", domain: "GENERAL", filters: [{ key: "platform", label: "Plateforme", type: "SELECT", options: ["PlayStation", "Xbox", "Nintendo", "PC", "Retro", "Autre"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Photo & vidéo", slug: "photo-video", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "cameraType", label: "Type", type: "SELECT", options: ["Hybride", "Reflex", "Compact", "Action cam", "Caméscope", "Objectif", "Drone", "Accessoire"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Audio & casques", slug: "audio-casques", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "audioType", label: "Type", type: "SELECT", options: ["Casque", "Écouteurs", "Enceinte", "Hi-Fi", "DJ", "Microphone"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Maison & Jardin", slug: "maison-jardin", icon: "🛋️", domain: "GENERAL",
    children: [
      { name: "Meubles", slug: "meubles", domain: "GENERAL", filters: [{ key: "room", label: "Pièce", type: "SELECT", options: ["Salon", "Chambre", "Cuisine", "Salle de bain", "Bureau", "Extérieur"] }, { key: "material", label: "Matière", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Électroménager", slug: "electromenager", domain: "GENERAL", filters: [{ key: "appliance", label: "Appareil", type: "SELECT", options: ["Réfrigérateur", "Lave-linge", "Sèche-linge", "Lave-vaisselle", "Four", "Micro-ondes", "Aspirateur", "Petit électroménager"] }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "energyClass", label: "Classe énergétique", type: "SELECT", options: ["A", "B", "C", "D", "E", "F", "G"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Décoration", slug: "decoration", domain: "GENERAL", filters: [{ key: "decorType", label: "Type", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Bricolage", slug: "bricolage", domain: "GENERAL", filters: [{ key: "toolType", label: "Type", type: "SELECT", options: ["Outillage électroportatif", "Outillage à main", "Matériaux", "Quincaillerie", "Électricité", "Plomberie", "Peinture"] }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Jardin & extérieur", slug: "jardin-exterieur", domain: "GENERAL", filters: [{ key: "gardenType", label: "Type", type: "SELECT", options: ["Mobilier", "Barbecue", "Piscine", "Motoculture", "Plantes", "Aménagement"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Mode", slug: "mode", icon: "👗", domain: "GENERAL",
    children: [
      { name: "Vêtements femme", slug: "vetements-femme", domain: "GENERAL", filters: [{ key: "size", label: "Taille", type: "SELECT", options: ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL+"] }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "color", label: "Couleur", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Vêtements homme", slug: "vetements-homme", domain: "GENERAL", filters: [{ key: "size", label: "Taille", type: "SELECT", options: ["XS", "S", "M", "L", "XL", "XXL", "3XL+"] }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Chaussures", slug: "chaussures", domain: "GENERAL", filters: [{ key: "shoeSize", label: "Pointure", type: "NUMBER" }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Sacs & accessoires", slug: "sacs-accessoires", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Montres & bijoux", slug: "montres-bijoux", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "material", label: "Matière", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Enfants & Bébé", slug: "enfants-bebe", icon: "🧸", domain: "GENERAL",
    children: [
      { name: "Vêtements bébé & enfant", slug: "vetements-enfant", domain: "GENERAL", filters: [{ key: "ageRange", label: "Âge / taille", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Poussettes & puériculture", slug: "poussettes-puericulture", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Sièges auto", slug: "sieges-auto", domain: "GENERAL", filters: [{ key: "standard", label: "Homologation", type: "SELECT", options: ["R129 / i-Size", "R44/04", "Autre"] }, { key: "isofix", label: "ISOFIX", type: "BOOLEAN" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Jouets & jeux", slug: "jouets-jeux", domain: "GENERAL", filters: [{ key: "ageRange", label: "Tranche d'âge", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Sports & Loisirs", slug: "sports-loisirs", icon: "⚽", domain: "GENERAL",
    children: [
      { name: "Vélos", slug: "velos", domain: "GENERAL", filters: [{ key: "bikeType", label: "Type", type: "SELECT", options: ["VTT", "Route", "Ville", "Gravel", "BMX", "Électrique", "Enfant"] }, { key: "frameSize", label: "Taille cadre", type: "TEXT" }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Fitness & musculation", slug: "fitness-musculation", domain: "GENERAL", filters: [{ key: "equipment", label: "Équipement", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Football & sports collectifs", slug: "football-sports-collectifs", domain: "GENERAL", filters: [{ key: "sport", label: "Sport", type: "SELECT", options: ["Football", "Basketball", "Handball", "Rugby", "Volley", "Autre"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Camping & randonnée", slug: "camping-randonnee", domain: "GENERAL", filters: [{ key: "equipment", label: "Équipement", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Pêche", slug: "peche", domain: "GENERAL", filters: [{ key: "equipment", label: "Matériel", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Instruments de musique", slug: "instruments-musique", domain: "GENERAL", filters: [{ key: "instrument", label: "Instrument", type: "TEXT" }, { key: "brand", label: "Marque", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
      { name: "Collection", slug: "collection", domain: "GENERAL", filters: [{ key: "collectionType", label: "Type de collection", type: "TEXT" }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Emploi", slug: "emploi", icon: "💼", domain: "JOB",
    children: [
      { name: "Commerce & vente", slug: "emploi-commerce-vente", domain: "JOB", filters: [{ key: "contract", label: "Contrat", type: "SELECT", options: ["CDI", "CDD", "Intérim", "Stage", "Alternance", "Freelance"] , group: "job" }, { key: "schedule", label: "Temps de travail", type: "SELECT", options: ["Temps plein", "Temps partiel"] , group: "job" }, { key: "remote", label: "Télétravail", type: "SELECT", options: ["Non", "Partiel", "Total"] , group: "job" }, { key: "salaryMin", label: "Salaire à partir de", type: "NUMBER", unit: "€/an", group: "job" }] },
      { name: "Transport & logistique", slug: "emploi-transport-logistique", domain: "JOB" },
      { name: "BTP", slug: "emploi-btp", domain: "JOB" },
      { name: "Hôtellerie & restauration", slug: "emploi-hotellerie-restauration", domain: "JOB" },
      { name: "Santé & social", slug: "emploi-sante-social", domain: "JOB" },
      { name: "Informatique & digital", slug: "emploi-informatique-digital", domain: "JOB" },
      { name: "Administratif & finance", slug: "emploi-administratif-finance", domain: "JOB" },
      { name: "Services à la personne", slug: "emploi-services-personne", domain: "JOB" },
    ]
  },
  {
    name: "Services", slug: "services", icon: "🧰", domain: "SERVICE",
    children: [
      { name: "Bâtiment & travaux", slug: "services-batiment-travaux", domain: "SERVICE", filters: [{ key: "serviceType", label: "Prestation", type: "TEXT" }, { key: "professional", label: "Professionnel", type: "BOOLEAN" }, { key: "travelRadius", label: "Zone d'intervention", type: "NUMBER", unit: "km" }] },
      { name: "Ménage & entretien", slug: "services-menage-entretien", domain: "SERVICE" },
      { name: "Transport & déménagement", slug: "services-transport-demenagement", domain: "SERVICE" },
      { name: "Informatique & dépannage", slug: "services-informatique", domain: "SERVICE" },
      { name: "Cours & formation", slug: "services-cours-formation", domain: "SERVICE" },
      { name: "Événementiel", slug: "services-evenementiel", domain: "SERVICE" },
      { name: "Beauté & bien-être", slug: "services-beaute-bien-etre", domain: "SERVICE" },
    ]
  },
  {
    name: "Animaux", slug: "animaux", icon: "🐾", domain: "ANIMAL",
    children: [
      { name: "Chiens", slug: "chiens", domain: "ANIMAL", filters: [{ key: "breed", label: "Race", type: "TEXT" }, { key: "age", label: "Âge", type: "NUMBER", unit: "mois" }, { key: "sex", label: "Sexe", type: "SELECT", options: ["Mâle", "Femelle"] }, { key: "identified", label: "Identifié", type: "BOOLEAN", group: "legal" }] },
      { name: "Chats", slug: "chats", domain: "ANIMAL", filters: [{ key: "breed", label: "Race", type: "TEXT" }, { key: "age", label: "Âge", type: "NUMBER", unit: "mois" }, { key: "sex", label: "Sexe", type: "SELECT", options: ["Mâle", "Femelle"] }, { key: "identified", label: "Identifié", type: "BOOLEAN", group: "legal" }] },
      { name: "Chevaux", slug: "chevaux", domain: "ANIMAL", filters: [{ key: "breed", label: "Race", type: "TEXT" }, { key: "age", label: "Âge", type: "NUMBER", unit: "ans" }, { key: "sex", label: "Sexe", type: "SELECT", options: ["Mâle", "Femelle", "Hongre"] }] },
      { name: "Oiseaux", slug: "oiseaux", domain: "ANIMAL" },
      { name: "Petits animaux", slug: "petits-animaux", domain: "ANIMAL" },
      { name: "Accessoires pour animaux", slug: "accessoires-animaux", domain: "GENERAL", filters: [{ key: "animalType", label: "Animal", type: "SELECT", options: ["Chien", "Chat", "Cheval", "Oiseau", "Rongeur", "Autre"] }, { key: "condition", label: "État", type: "SELECT", options: condition }] },
    ]
  },
  {
    name: "Matériel professionnel", slug: "materiel-professionnel", icon: "🏗️", domain: "GENERAL",
    children: [
      { name: "BTP & chantier", slug: "materiel-btp-chantier", domain: "GENERAL" },
      { name: "Commerce & restauration", slug: "materiel-commerce-restauration", domain: "GENERAL" },
      { name: "Bureautique", slug: "materiel-bureautique", domain: "GENERAL" },
      { name: "Industrie & atelier", slug: "materiel-industrie-atelier", domain: "GENERAL" },
    ]
  },
  {
    name: "Agriculture", slug: "agriculture", icon: "🚜", domain: "GENERAL",
    children: [
      { name: "Tracteurs", slug: "tracteurs", domain: "GENERAL", filters: [{ key: "brand", label: "Marque", type: "TEXT" }, { key: "year", label: "Année", type: "NUMBER" }, { key: "hours", label: "Heures", type: "NUMBER", unit: "h" }] },
      { name: "Matériel agricole", slug: "materiel-agricole", domain: "GENERAL" },
      { name: "Élevage", slug: "elevage", domain: "GENERAL" },
    ]
  },
  {
    name: "Livres, Films & Billetterie", slug: "culture-billetterie", icon: "🎟️", domain: "GENERAL",
    children: [
      { name: "Livres & BD", slug: "livres-bd", domain: "GENERAL" },
      { name: "Films & musique", slug: "films-musique", domain: "GENERAL" },
      { name: "Billets & événements", slug: "billets-evenements", domain: "GENERAL" },
    ]
  },
];

export function flattenCatalog(nodes: CatalogCategory[] = catalog, parentSlug?: string): Array<CatalogCategory & { parentSlug?: string }> {
  return nodes.flatMap((node) => [
    { ...node, parentSlug },
    ...flattenCatalog(node.children ?? [], node.slug),
  ]);
}

export function findCategory(slug: string): CatalogCategory | undefined {
  return flattenCatalog().find((category) => category.slug === slug);
}
