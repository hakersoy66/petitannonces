import { catalog, type CatalogCategory, type CatalogFilter } from "@pa/types";
import { prisma } from "../src/index.js";

async function upsertCategory(category: CatalogCategory, parentId?: string) {
  return prisma.category.upsert({
    where: { slug: category.slug },
    update: {
      name: category.name,
      domain: category.domain,
      parentId: parentId ?? null,
    },
    create: {
      name: category.name,
      slug: category.slug,
      domain: category.domain,
      parentId: parentId ?? null,
    },
  });
}

async function upsertAttribute(categoryId: string, filter: CatalogFilter, sortOrder: number) {
  const attribute = await prisma.categoryAttribute.upsert({
    where: { categoryId_key: { categoryId, key: filter.key } },
    update: {
      label: filter.label,
      type: filter.type,
      required: filter.required ?? false,
      sortOrder,
      unit: filter.unit ?? null,
    },
    create: {
      categoryId,
      key: filter.key,
      label: filter.label,
      type: filter.type,
      required: filter.required ?? false,
      sortOrder,
      unit: filter.unit ?? null,
    },
  });

  for (const [index, value] of (filter.options ?? []).entries()) {
    await prisma.categoryAttributeOption.upsert({
      where: { attributeId_value: { attributeId: attribute.id, value } },
      update: { label: value, sortOrder: index },
      create: { attributeId: attribute.id, value, label: value, sortOrder: index },
    });
  }
}

async function seedNode(category: CatalogCategory, parentId?: string) {
  const dbCategory = await upsertCategory(category, parentId);

  for (const [index, filter] of (category.filters ?? []).entries()) {
    await upsertAttribute(dbCategory.id, filter, (index + 1) * 10);
  }

  for (const child of category.children ?? []) {
    await seedNode(child, dbCategory.id);
  }
}

async function main() {
  for (const category of catalog) await seedNode(category);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
