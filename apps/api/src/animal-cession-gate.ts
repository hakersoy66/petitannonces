/** Central publication hold while official I-CAD production validation is unavailable. */
export function animalCessionRequiresProductionApproval(category: { domain: string; slug: string } | null | undefined): boolean {
  return category?.domain === "ANIMAL" && category.slug !== "animaux-perdus";
}
