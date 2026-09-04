import type { Metadata } from "next";

type Props = { params: Promise<{ category: string; city: string }> };

function pretty(value: string) {
  return decodeURIComponent(value).replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, city } = await params;
  const categoryName = pretty(category);
  const cityName = pretty(city);
  return {
    title: `${categoryName} à ${cityName} - Annonces | Petit Annonces`,
    description: `Découvrez les annonces ${categoryName.toLowerCase()} à ${cityName} sur Petit Annonces. Recherche locale, filtres et annonces récentes.`,
    alternates: { canonical: `/c/${category}/${city}` },
  };
}

export default async function CategoryCityPage({ params }: Props) {
  const { category, city } = await params;
  const categoryName = pretty(category);
  const cityName = pretty(city);
  return (
    <main className="shell" style={{ padding: "32px 0 72px" }}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#6b7280", marginBottom: 16 }}>Accueil › {categoryName} › {cityName}</nav>
      <h1>{categoryName} à {cityName}</h1>
      <p style={{ color: "#6b7280", maxWidth: 760 }}>Retrouvez les annonces disponibles à {cityName}. Cette page SEO locale est reliée au moteur de recherche et aux filtres dynamiques Petit Annonces.</p>
      <a className="button button-primary" href={`/recherche?category=${encodeURIComponent(category)}&city=${encodeURIComponent(cityName)}`}>Voir les annonces</a>
    </main>
  );
}
