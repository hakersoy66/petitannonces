import { deepCatalog, type CatalogFilter } from "@pa/types";
import { prisma } from "../src/index.js";

async function main() {
  const root = deepCatalog.find(category => category.slug === "vehicules");
  const children = (root?.children ?? []).filter(category =>
    ["location-vehicules", "transfert-vip"].includes(category.slug)
  );
  if (!root || children.length !== 2) throw new Error("transport_categories_missing");
  const parent = await prisma.category.findUnique({ where: { slug: root.slug } });
  if (!parent) throw new Error("vehicles_root_missing");
  for (const [offset, category] of children.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      create: { name: category.name, slug: category.slug, domain: category.domain, parentId: parent.id, sortOrder: 60 + offset * 10 },
      update: { name: category.name, domain: category.domain, parentId: parent.id },
    });
    for (const [index, filter] of (category.filters ?? []).entries()) {
      const field = filter as CatalogFilter;
      const attribute = await prisma.categoryAttribute.upsert({
        where: { categoryId_key: { categoryId: row.id, key: field.key } },
        create: { categoryId: row.id, key: field.key, label: field.label, type: field.type, required: field.required ?? false, unit: field.unit ?? null, sortOrder: (index + 1) * 10 },
        update: { label: field.label, type: field.type, required: field.required ?? false, unit: field.unit ?? null, sortOrder: (index + 1) * 10 },
      });
      for (const [position, option] of (field.options ?? []).entries()) {
        await prisma.categoryAttributeOption.upsert({
          where: { attributeId_value: { attributeId: attribute.id, value: option } },
          create: { attributeId: attribute.id, value: option, label: option, sortOrder: position },
          update: { label: option, sortOrder: position },
        });
      }
    }
    console.log(category.slug, "fields", category.filters?.length ?? 0);
  }
}

main().finally(async () => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
