import type { Metadata } from "next";
import { deepCatalog, findDeepCategory, type CatalogCategory } from "@pa/types";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../../components/site-header";
import styles from "./page.module.css";

type Props = { params: Promise<{ slug: string }> };

type TrailItem = { name: string; slug: string };

function findTrail(slug: string, nodes: CatalogCategory[] = deepCatalog, trail: TrailItem[] = []): TrailItem[] | null {
  for (const node of nodes) {
    const next = [...trail, { name: node.name, slug: node.slug }];
    if (node.slug === slug) return next;
    const nested = findTrail(slug, node.children ?? [], next);
    if (nested) return nested;
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = findDeepCategory(slug);
  if (!category) return { title: "Catégorie | Petit Annonces" };
  return {
    title: `${category.name} - Petites annonces en France | Petit Annonces`,
    description: category.description ?? `Découvrez les annonces ${category.name.toLowerCase()} partout en France avec des filtres adaptés.`,
    alternates: { canonical: `/categorie/${slug}` },
  };
}

export default async function CategoryLandingPage({ params }: Props) {
  const { slug } = await params;
  const category = findDeepCategory(slug);
  if (!category) notFound();

  const trail = findTrail(slug) ?? [{ name: category.name, slug: category.slug }];
  const root = deepCatalog.find((item) => item.slug === trail[0]?.slug);
  const children = category.children ?? [];
  const filters = category.filters ?? [];

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.shell}>
        <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">
          <a href="/">Accueil</a>
          {trail.map((item, index) => <span key={item.slug}> › {index === trail.length - 1 ? item.name : <a href={`/categorie/${item.slug}`}>{item.name}</a>}</span>)}
        </nav>

        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{root?.icon ?? "•"} Catégorie</p>
            <h1>{category.name}</h1>
            <p>{category.description ?? `Achetez et vendez dans la catégorie ${category.name} partout en France.`}</p>
          </div>
          <form action="/recherche" className={styles.search}>
            <input type="hidden" name="category" value={category.slug} />
            <input name="q" placeholder={`Rechercher dans ${category.name}`} />
            <input name="city" placeholder="Ville ou code postal" />
            <button type="submit">Rechercher</button>
          </form>
        </section>

        {children.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}><div><span>Explorer</span><h2>Sous-catégories</h2></div><small>{children.length} choix</small></div>
            <div className={styles.subgrid}>
              {children.map((child) => (
                <a key={child.slug} href={`/categorie/${child.slug}`}>
                  <strong>{child.name}</strong>
                  <span>{child.filters?.slice(-3).map((filter) => filter.label).join(" · ") || "Voir les annonces"}</span>
                  <b>›</b>
                </a>
              ))}
            </div>
          </section>
        )}

        {filters.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHead}><div><span>Affiner</span><h2>Filtres disponibles</h2></div><small>{filters.length} filtres</small></div>
            <div className={styles.filtergrid}>
              {filters.map((filter, index) => <span key={`${filter.key}-${index}`}>{filter.label}{filter.unit ? ` · ${filter.unit}` : ""}</span>)}
            </div>
          </section>
        )}

        <section className={styles.trust}>
          <div><b>Recherche locale</b><span>Ville, code postal et distance.</span></div>
          <div><b>Filtres adaptés</b><span>Chaque niveau de catégorie affiche uniquement les critères utiles.</span></div>
          <div><b>Transaction sécurisée</b><span>Paiement, livraison et suivi lorsque disponibles.</span></div>
        </section>
      </main>
    </div>
  );
}
