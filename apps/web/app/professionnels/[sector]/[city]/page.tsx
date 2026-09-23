import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppIcon } from "../../../../components/app-icon";
import styles from "../../page.module.css";

export const revalidate = 120;

const DEFAULT_STORE_LOGO = "/store-defaults/default-boutique-logo.webp";
const DEFAULT_STORE_COVER = "/store-defaults/default-boutique-cover.webp";
const BASE = "https://petitannonces.fr";

type StoreSector = { slug: string; name: string; count: number };
type PublicStore = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string | null;
  postalCode: string | null;
  updatedAt?: string;
  activeListings: number;
  verified: boolean;
  siretVerified: boolean;
  nafCode: string | null;
  primarySector: StoreSector | null;
  sectors: StoreSector[];
};

type Props = { params: Promise<{ sector: string; city: string }> };

const apiBase = () => (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function safeJsonLd(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c"); }

async function stores(): Promise<PublicStore[]> {
  try {
    const r = await fetch(`${apiBase()}/public/stores`, { next: { revalidate: 120 } });
    if (!r.ok) return [];
    const d = await r.json() as { stores?: PublicStore[] };
    return d.stores ?? [];
  } catch {
    return [];
  }
}

function resolvePair(allStores: PublicStore[], sectorSlug: string, citySlug: string) {
  const matched = allStores.filter(store => Boolean(store.city) && slugify(store.city!) === citySlug && (store.sectors ?? []).some(item => item.slug === sectorSlug));
  const cityName = matched[0]?.city ?? null;
  const sectorName = matched.flatMap(store => store.sectors ?? []).find(item => item.slug === sectorSlug)?.name ?? null;
  return { matched, cityName, sectorName };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sector, city } = await params;
  const allStores = await stores();
  const { matched, cityName, sectorName } = resolvePair(allStores, sector, city);
  if (!matched.length || !cityName || !sectorName) return { title: { absolute: "Professionnels | Petit Annonces" }, robots: { index: false, follow: true } };
  const canonical = `/professionnels/${sector}/${city}`;
  const title = `${sectorName} à ${cityName} : professionnels et boutiques | Petit Annonces`;
  const description = `Découvrez ${matched.length} professionnel${matched.length > 1 ? "s" : ""} et boutique${matched.length > 1 ? "s" : ""} ${sectorName.toLowerCase()} à ${cityName} sur Petit Annonces, avec annonces actives et informations de vérification.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: canonical, title, description },
  };
}

export default async function ProfessionalSectorCityPage({ params }: Props) {
  const { sector, city } = await params;
  const allStores = await stores();
  const { matched, cityName, sectorName } = resolvePair(allStores, sector, city);
  if (!matched.length || !cityName || !sectorName) notFound();

  const canonicalPath = `/professionnels/${sector}/${city}`;
  const canonical = `${BASE}${canonicalPath}`;
  const relatedCities = [...new Map(allStores
    .filter(store => store.city && slugify(store.city) !== city && (store.sectors ?? []).some(item => item.slug === sector))
    .map(store => [slugify(store.city!), store.city!] as const)).entries()].slice(0, 8);
  const relatedSectors = [...new Map(allStores
    .filter(store => store.city && slugify(store.city) === city)
    .flatMap(store => store.sectors ?? [])
    .filter(item => item.slug !== sector)
    .map(item => [item.slug, item.name] as const)).entries()].slice(0, 8);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: "Professionnels", item: `${BASE}/professionnels` },
      { "@type": "ListItem", position: 3, name: sectorName, item: `${BASE}/professionnels/secteur/${sector}` },
      { "@type": "ListItem", position: 4, name: `${sectorName} à ${cityName}`, item: canonical },
    ],
  };
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Professionnels ${sectorName} à ${cityName}`,
    url: canonical,
    numberOfItems: matched.length,
    itemListElement: matched.map((store, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "LocalBusiness",
        name: store.name,
        url: `${BASE}/boutique/${store.slug}`,
        image: store.logoUrl ? [store.logoUrl] : [`${BASE}${DEFAULT_STORE_LOGO}`],
        address: { "@type": "PostalAddress", postalCode: store.postalCode ?? undefined, addressLocality: store.city ?? undefined, addressCountry: "FR" },
      },
    })),
  };

  return <div className={styles.page}>
    
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(itemList) }} />
    <main>
      <section className={styles.directory} style={{ paddingTop: 42 }}>
        <div className={styles.shell}>
          <nav aria-label="Fil d’Ariane" style={{ fontSize: 12, color: "#747584", marginBottom: 18 }}>
            <a href="/" style={{ color: "#5b4cf0" }}>Accueil</a> › <a href="/professionnels" style={{ color: "#5b4cf0" }}>Professionnels</a> › <a href={`/professionnels/secteur/${sector}`} style={{ color: "#5b4cf0" }}>{sectorName}</a> › {cityName}
          </nav>

          <header style={{ padding: "31px 32px", borderRadius: 28, background: "linear-gradient(135deg,#4f43d4,#7569f6)", color: "white", boxShadow: "0 22px 58px rgba(67,55,160,.18)" }}>
            <span style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", opacity: .86 }}><AppIcon name="store" /> Annuaire professionnel local</span>
            <h1 style={{ margin: "8px 0 9px", fontSize: "clamp(30px,5vw,52px)", lineHeight: 1.02, letterSpacing: "-.05em" }}>{sectorName} à {cityName}</h1>
            <p style={{ margin: 0, maxWidth: 850, lineHeight: 1.65, opacity: .92 }}>Retrouvez les boutiques et vendeurs professionnels actifs dans le secteur {sectorName.toLowerCase()} à {cityName}. Consultez leurs annonces, leur localisation et leurs informations de vérification avant de les contacter.</p>
          </header>

          <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "24px 0 5px" }}>
            <div><strong>{matched.length} professionnel{matched.length > 1 ? "s" : ""}</strong><div style={{ marginTop: 3, color: "#858692", fontSize: 12 }}>Boutiques avec au moins une annonce actuellement publiée.</div></div>
            <a href={`/professionnels?city=${encodeURIComponent(cityName)}&sector=${encodeURIComponent(sector)}#annuaire`} style={{ display: "inline-flex", minHeight: 42, alignItems: "center", gap: 7, padding: "0 14px", borderRadius: 12, background: "#5b4cf0", color: "white", textDecoration: "none", fontSize: 12, fontWeight: 900 }}><AppIcon name="search" /> Ouvrir les filtres</a>
          </section>

          <div className={styles.storeGrid}>
            {matched.map(store => <article className={styles.storeCard} key={store.id}>
              <a className={styles.storeCover} href={`/boutique/${store.slug}`} aria-label={`Voir la boutique ${store.name}`}><img src={store.coverUrl || DEFAULT_STORE_COVER} alt="" />{store.verified && <span className={styles.verifiedBadge}><AppIcon name="circle-check" /> Vérifié</span>}</a>
              <div className={styles.storeBody}>
                <a className={styles.storeLogo} href={`/boutique/${store.slug}`}><img src={store.logoUrl || DEFAULT_STORE_LOGO} alt={`Logo ${store.name}`} /></a>
                <div className={styles.storeTitleRow}><div><h3><a href={`/boutique/${store.slug}`}>{store.name}</a></h3><p>{[store.postalCode, store.city].filter(Boolean).join(" ")}</p></div><strong>{store.activeListings}<span> annonces</span></strong></div>
                <div className={styles.storeTags}><span>{sectorName}</span>{store.siretVerified && <span className={styles.siretTag}>SIRET vérifié</span>}</div>
                {store.description && <p className={styles.storeDescription}>{store.description}</p>}
                <div className={styles.storeFooter}><span>{store.nafCode ? `NAF ${store.nafCode}` : "Professionnel"}</span><a href={`/boutique/${store.slug}`}>Voir la boutique <AppIcon name="arrow-right" /></a></div>
              </div>
            </article>)}
          </div>

          <section style={{ marginTop: 30, padding: 24, border: "1px solid #e6e5ed", borderRadius: 22, background: "#fff" }}>
            <small style={{ color: "#5b4cf0", fontWeight: 900, letterSpacing: .7 }}>PROFESSIONNELS À {cityName.toUpperCase()}</small>
            <h2 style={{ margin: "6px 0 9px", fontSize: 24, letterSpacing: "-.03em" }}>Comment choisir un professionnel {sectorName.toLowerCase()} à {cityName} ?</h2>
            <p style={{ margin: 0, color: "#696b78", lineHeight: 1.7, fontSize: 14 }}>Comparez les annonces actuellement publiées, les informations de la boutique et la localisation indiquée. Lorsqu’un badge SIRET vérifié est affiché, cela signifie que les informations professionnelles enregistrées sur Petit Annonces ont été vérifiées. Utilisez ensuite la messagerie ou les coordonnées disponibles sur la boutique pour préparer votre échange.</p>
          </section>

          {(relatedCities.length > 0 || relatedSectors.length > 0) && <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16, marginTop: 22 }}>
            {relatedCities.length > 0 && <article style={{ padding: 21, border: "1px solid #e6e5ed", borderRadius: 20, background: "#fff" }}><small style={{ color: "#858692", fontWeight: 850 }}>AUTRES VILLES</small><h2 style={{ margin: "5px 0 13px", fontSize: 19 }}>{sectorName} ailleurs en France</h2><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{relatedCities.map(([slug, name]) => <a key={slug} href={`/professionnels/${sector}/${slug}`} style={{ padding: "8px 10px", border: "1px solid #e4e3eb", borderRadius: 999, color: "#5145cc", textDecoration: "none", fontSize: 11, fontWeight: 850 }}>{name}</a>)}</div></article>}
            {relatedSectors.length > 0 && <article style={{ padding: 21, border: "1px solid #e6e5ed", borderRadius: 20, background: "#fff" }}><small style={{ color: "#858692", fontWeight: 850 }}>AUTRES SECTEURS</small><h2 style={{ margin: "5px 0 13px", fontSize: 19 }}>Autres professionnels à {cityName}</h2><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{relatedSectors.map(([slug, name]) => <a key={slug} href={`/professionnels/${slug}/${city}`} style={{ padding: "8px 10px", border: "1px solid #e4e3eb", borderRadius: 999, color: "#5145cc", textDecoration: "none", fontSize: 11, fontWeight: 850 }}>{name}</a>)}</div></article>}
          </section>}

          <div className={styles.directoryCta}><div><span>Vous êtes professionnel ?</span><h3>Présentez aussi votre entreprise sur Petit Annonces.</h3><p>Créez votre boutique Pro, publiez vos annonces et apparaissez automatiquement dans l’annuaire lorsque votre boutique est active.</p></div><a href="/inscription/pro">Créer ma boutique Pro <AppIcon name="arrow-right" /></a></div>
        </div>
      </section>
    </main>
    
  </div>;
}