import { catalog, type CatalogCategory, type CatalogFilter } from "./catalog";

const carShape: CatalogFilter = { key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["Citadine", "Berline", "Break", "SUV", "Coupé", "Cabriolet", "Monospace", "Utilitaire léger"] };
const phoneBrand: CatalogFilter = { key: "brand", label: "Marque", type: "SELECT", options: ["Apple", "Samsung", "Google", "Xiaomi", "Honor", "OnePlus", "Huawei", "Oppo", "Motorola", "Nothing", "Autre"], required: true, group: "identity" };

function inherit(parent: CatalogCategory, child: Omit<CatalogCategory, "domain" | "filters"> & { filters?: CatalogFilter[] }): CatalogCategory {
  return {
    ...child,
    domain: parent.domain,
    filters: [...(parent.filters ?? []), ...(child.filters ?? [])],
  };
}

function deepen(node: CatalogCategory): CatalogCategory {
  const base: CatalogCategory = { ...node, children: node.children?.map(deepen) };

  if (node.slug === "voitures") {
    base.filters = [...(node.filters ?? []), carShape];
    base.children = [
      inherit(base, { name: "Citadines", slug: "voitures-citadines", filters: [{ key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["Citadine"] }] }),
      inherit(base, { name: "Berlines", slug: "voitures-berlines", filters: [{ key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["Berline"] }] }),
      inherit(base, { name: "SUV & Crossovers", slug: "voitures-suv", filters: [{ key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["SUV"] }, { key: "fourWheelDrive", label: "4 roues motrices", type: "BOOLEAN" }] }),
      inherit(base, { name: "Breaks", slug: "voitures-breaks", filters: [{ key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["Break"] }] }),
      inherit(base, { name: "Coupés & Cabriolets", slug: "voitures-coupes-cabriolets", filters: [{ key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["Coupé", "Cabriolet"] }] }),
      inherit(base, { name: "Monospaces", slug: "voitures-monospaces", filters: [{ key: "bodyStyle", label: "Carrosserie", type: "SELECT", options: ["Monospace"] }, { key: "seats", label: "Nombre de places", type: "NUMBER" }] }),
      inherit(base, { name: "Électriques", slug: "voitures-electriques", filters: [{ key: "fuel", label: "Énergie", type: "SELECT", options: ["Électrique"] }, { key: "batteryCapacity", label: "Capacité batterie", type: "NUMBER", unit: "kWh" }, { key: "rangeKm", label: "Autonomie WLTP", type: "NUMBER", unit: "km" }] }),
      inherit(base, { name: "Hybrides", slug: "voitures-hybrides", filters: [{ key: "fuel", label: "Énergie", type: "SELECT", options: ["Hybride", "Hybride rechargeable"] }] }),
    ];
  }

  if (node.slug === "telephones-smartphones") {
    base.filters = [phoneBrand, ...(node.filters ?? []).filter((f) => f.key !== "brand")];
    base.children = [
      inherit(base, { name: "Apple iPhone", slug: "apple-iphone", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["Apple"] }, { key: "model", label: "Modèle", type: "SELECT", options: ["iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17", "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16", "iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15", "iPhone 14", "iPhone 13", "iPhone SE"] }] }),
      inherit(base, { name: "Samsung Galaxy", slug: "samsung-galaxy", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["Samsung"] }, { key: "series", label: "Gamme", type: "SELECT", options: ["Galaxy S", "Galaxy Z", "Galaxy A", "Galaxy M"] }] }),
      inherit(base, { name: "Google Pixel", slug: "google-pixel", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["Google"] }, { key: "series", label: "Gamme", type: "SELECT", options: ["Pixel Pro", "Pixel", "Pixel Fold", "Pixel a"] }] }),
      inherit(base, { name: "Xiaomi / Redmi / Poco", slug: "xiaomi-redmi-poco", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["Xiaomi"] }, { key: "series", label: "Gamme", type: "SELECT", options: ["Xiaomi", "Redmi Note", "Redmi", "Poco"] }] }),
      inherit(base, { name: "Honor", slug: "honor-smartphones", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["Honor"] }] }),
      inherit(base, { name: "OnePlus", slug: "oneplus-smartphones", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["OnePlus"] }] }),
    ];
  }

  if (node.slug === "electromenager") {
    base.children = [
      inherit(base, { name: "Lave-linge", slug: "lave-linge", filters: [{ key: "capacityKg", label: "Capacité", type: "NUMBER", unit: "kg" }, { key: "spinRpm", label: "Essorage", type: "NUMBER", unit: "tr/min" }] }),
      inherit(base, { name: "Sèche-linge", slug: "seche-linge", filters: [{ key: "dryerType", label: "Technologie", type: "SELECT", options: ["Pompe à chaleur", "Condensation", "Évacuation"] }, { key: "capacityKg", label: "Capacité", type: "NUMBER", unit: "kg" }] }),
      inherit(base, { name: "Réfrigérateurs & congélateurs", slug: "refrigerateurs-congelateurs", filters: [{ key: "fridgeType", label: "Type", type: "SELECT", options: ["Réfrigérateur", "Combiné", "Américain", "Congélateur armoire", "Congélateur coffre"] }, { key: "volumeL", label: "Volume", type: "NUMBER", unit: "L" }] }),
      inherit(base, { name: "Lave-vaisselle", slug: "lave-vaisselle", filters: [{ key: "placeSettings", label: "Couverts", type: "NUMBER" }, { key: "widthCm", label: "Largeur", type: "NUMBER", unit: "cm" }] }),
      inherit(base, { name: "Fours & plaques", slug: "fours-plaques", filters: [{ key: "cookingType", label: "Type", type: "SELECT", options: ["Four encastrable", "Mini-four", "Plaque induction", "Plaque vitrocéramique", "Plaque gaz", "Cuisinière"] }] }),
      inherit(base, { name: "Aspirateurs", slug: "aspirateurs", filters: [{ key: "vacuumType", label: "Type", type: "SELECT", options: ["Balai", "Traîneau", "Robot", "Main"] }, { key: "cordless", label: "Sans fil", type: "BOOLEAN" }] }),
    ];
  }

  if (node.slug === "ordinateurs-portables") {
    base.children = [
      inherit(base, { name: "Ultrabooks", slug: "ultrabooks", filters: [{ key: "weightKg", label: "Poids", type: "NUMBER", unit: "kg" }] }),
      inherit(base, { name: "PC gamer", slug: "pc-portables-gamer", filters: [{ key: "gpu", label: "Carte graphique", type: "TEXT" }, { key: "refreshRate", label: "Fréquence écran", type: "NUMBER", unit: "Hz" }] }),
      inherit(base, { name: "MacBook", slug: "macbook", filters: [{ key: "brand", label: "Marque", type: "SELECT", options: ["Apple"] }, { key: "chip", label: "Puce", type: "SELECT", options: ["M1", "M2", "M3", "M4", "M5"] }] }),
      inherit(base, { name: "Chromebooks", slug: "chromebooks", filters: [{ key: "os", label: "Système", type: "SELECT", options: ["ChromeOS"] }] }),
    ];
  }

  if (node.slug === "sports-loisirs") {
    base.children = [
      ...(base.children ?? []),
      { name: "Cyclisme", slug: "cyclisme", domain: "GENERAL", children: [
        { name: "Vélos de route", slug: "velos-route", domain: "GENERAL", filters: [{ key: "frameSize", label: "Taille cadre", type: "TEXT" }, { key: "frameMaterial", label: "Cadre", type: "SELECT", options: ["Aluminium", "Carbone", "Acier", "Titane"] }] },
        { name: "VTT", slug: "vtt", domain: "GENERAL", filters: [{ key: "suspension", label: "Suspension", type: "SELECT", options: ["Rigide", "Semi-rigide", "Tout suspendu"] }, { key: "wheelSize", label: "Roues", type: "SELECT", options: ["26\"", "27,5\"", "29\""] }] },
        { name: "Vélos électriques", slug: "velos-electriques", domain: "GENERAL", filters: [{ key: "batteryWh", label: "Batterie", type: "NUMBER", unit: "Wh" }, { key: "motorNm", label: "Couple moteur", type: "NUMBER", unit: "Nm" }] },
      ] },
    ];
  }

  return base;
}

export const deepCatalog: CatalogCategory[] = catalog.map(deepen);

export function flattenDeepCatalog(categories: CatalogCategory[] = deepCatalog): CatalogCategory[] {
  return categories.flatMap((category) => [category, ...flattenDeepCatalog(category.children ?? [])]);
}

export function findDeepCategory(slug: string): CatalogCategory | undefined {
  return flattenDeepCatalog().find((category) => category.slug === slug);
}
