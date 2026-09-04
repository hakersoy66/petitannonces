import { prisma } from "../src/index.js";

async function upsertCategory(name: string, slug: string, domain: "GENERAL" | "VEHICLE" | "REAL_ESTATE", parentId?: string) {
  return prisma.category.upsert({
    where: { slug },
    update: { name, domain, parentId: parentId ?? null },
    create: { name, slug, domain, parentId: parentId ?? null },
  });
}

async function addAttribute(
  categoryId: string,
  key: string,
  label: string,
  type: "TEXT" | "NUMBER" | "BOOLEAN" | "SELECT" | "MULTISELECT" | "DATE",
  required: boolean,
  sortOrder: number,
  options: string[] = [],
  unit?: string,
) {
  const attribute = await prisma.categoryAttribute.upsert({
    where: { categoryId_key: { categoryId, key } },
    update: { label, type, required, sortOrder, unit: unit ?? null },
    create: { categoryId, key, label, type, required, sortOrder, unit: unit ?? null },
  });

  for (const [index, value] of options.entries()) {
    await prisma.categoryAttributeOption.upsert({
      where: { attributeId_value: { attributeId: attribute.id, value } },
      update: { label: value, sortOrder: index },
      create: { attributeId: attribute.id, value, label: value, sortOrder: index },
    });
  }
}

async function main() {
  const vehicles = await upsertCategory("Véhicules", "vehicules", "VEHICLE");
  const cars = await upsertCategory("Voitures", "voitures", "VEHICLE", vehicles.id);
  await upsertCategory("Motos", "motos", "VEHICLE", vehicles.id);
  await upsertCategory("Utilitaires", "utilitaires", "VEHICLE", vehicles.id);

  await addAttribute(cars.id, "condition", "État", "SELECT", true, 10, ["Neuf", "Comme neuf", "Très bon état", "Bon état", "À réparer"]);
  await addAttribute(cars.id, "owners", "Nombre de propriétaires", "NUMBER", false, 20);
  await addAttribute(cars.id, "warranty", "Sous garantie", "BOOLEAN", false, 30);

  const realEstate = await upsertCategory("Immobilier", "immobilier", "REAL_ESTATE");
  const sale = await upsertCategory("Vente immobilière", "vente-immobilier", "REAL_ESTATE", realEstate.id);
  const rental = await upsertCategory("Location", "location-immobilier", "REAL_ESTATE", realEstate.id);

  for (const category of [sale, rental]) {
    await addAttribute(category.id, "heating", "Type de chauffage", "SELECT", true, 10, ["Électrique", "Gaz", "Fioul", "Bois", "Pompe à chaleur", "Collectif", "Autre"]);
    await addAttribute(category.id, "elevator", "Ascenseur", "BOOLEAN", false, 20);
    await addAttribute(category.id, "parking", "Stationnement", "BOOLEAN", false, 30);
    await addAttribute(category.id, "balcony", "Balcon / terrasse", "BOOLEAN", false, 40);
  }

  const general = [
    ["High-tech", "high-tech"],
    ["Maison & Jardin", "maison-jardin"],
    ["Mode", "mode"],
    ["Sports & Loisirs", "sports-loisirs"],
    ["Enfants & Bébé", "enfants-bebe"],
    ["Services", "services"],
  ] as const;

  for (const [name, slug] of general) await upsertCategory(name, slug, "GENERAL");
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
