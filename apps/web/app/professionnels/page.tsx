import type { Metadata } from "next";
import { AppIcon } from "../../components/app-icon";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: { absolute: "Boutiques & professionnels en France | Petit Annonces" },
  description: "Trouvez des boutiques et professionnels en France par secteur et par ville. Les entreprises peuvent aussi ouvrir une vitrine Pro et publier leur catalogue sur Petit Annonces.",
  alternates: { canonical: "/professionnels" },
  openGraph: {
    type: "website",
    url: "/professionnels",
    title: "Boutiques & professionnels en France | Petit Annonces",
    description: "Découvrez des boutiques et entreprises par secteur et par ville, ou ouvrez votre vitrine Pro pour publier votre catalogue.",
  },
};

export const revalidate = 120;

const DEFAULT_STORE_LOGO = "/store-defaults/default-boutique-logo.webp";
const DEFAULT_STORE_COVER = "/store-defaults/default-boutique-cover.webp";
const PAGE_SIZE = 12;

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPriceMinor: number;
  yearlyPriceMinor: number | null;
  currency: string;
  maxActiveListings: number | null;
  maxStores: number;
  analyticsEnabled: boolean;
  autoRenewListings: boolean;
  prioritySupport: boolean;
  featuredCreditsMonthly: number;
  bulkImportEnabled: boolean;
  apiFeedEnabled: boolean;
};

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
  activeListings: number;
  verified: boolean;
  siretVerified: boolean;
  nafCode: string | null;
  primarySector: StoreSector | null;
  sectors: StoreSector[];
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function apiBase() {
  return (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

async function plans(): Promise<Plan[]> {
  try {
    const r = await fetch(`${apiBase()}/pro/plans`, { next: { revalidate: 300 } });
    if (!r.ok) return [];
    const p = (await r.json()) as { plans: Plan[] };
    return p.plans ?? [];
  } catch {
    return [];
  }
}

async function stores(): Promise<PublicStore[]> {
  try {
    const r = await fetch(`${apiBase()}/public/stores`, { next: { revalidate: 120 } });
    if (!r.ok) return [];
    const p = (await r.json()) as { stores?: PublicStore[] };
    return p.stores ?? [];
  } catch {
    return [];
  }
}

function euro(n: number, c = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: c, minimumFractionDigits: 2 }).format(n / 100);
}

function features(p: Plan) {
  return [
    ["Annonces actives", p.maxActiveListings == null ? "Illimité" : String(p.maxActiveListings)],
    ["Boutiques", String(p.maxStores)],
    ["Crédits À la une / mois", p.featuredCreditsMonthly > 0 ? String(p.featuredCreditsMonthly) : "—"],
    ["Analytics", p.analyticsEnabled ? "Inclus" : "—"],
    ["Renouvellement automatique", p.autoRenewListings ? "Inclus" : "—"],
    ["Import en masse", p.bulkImportEnabled ? "Inclus" : "—"],
    ["Support prioritaire", p.prioritySupport ? "Inclus" : "—"],
    ["Flux API", p.apiFeedEnabled ? "Inclus" : "—"],
  ] as const;
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function norm(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function slugify(value: string) {
  return norm(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function directoryUrl(values: { q?: string; city?: string; sector?: string; page?: number }) {
  const p = new URLSearchParams();
  if (values.q) p.set("q", values.q);
  if (values.city) p.set("city", values.city);
  if (values.sector) p.set("sector", values.sector);
  if (values.page && values.page > 1) p.set("page", String(values.page));
  const qs = p.toString();
  return `/professionnels${qs ? `?${qs}` : ""}#annuaire`;
}

export default async function ProfessionalsPage({ searchParams }: { searchParams: SearchParams }) {
  const [ps, allStores, raw] = await Promise.all([plans(), stores(), searchParams]);
  const q = one(raw.q).slice(0, 80).trim();
  const city = one(raw.city).slice(0, 80).trim();
  const sector = one(raw.sector).slice(0, 80).trim();
  const requestedPage = Math.max(1, Number.parseInt(one(raw.page), 10) || 1);

  const sectorMap = new Map<string, { slug: string; name: string; count: number }>();
  const cityMap = new Map<string, number>();
  for (const store of allStores) {
    if (store.city) cityMap.set(store.city, (cityMap.get(store.city) ?? 0) + 1);
    for (const item of store.sectors ?? []) {
      const existing = sectorMap.get(item.slug);
      sectorMap.set(item.slug, { slug: item.slug, name: item.name, count: (existing?.count ?? 0) + 1 });
    }
  }
  const cities = [...cityMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  const sectors = [...sectorMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));

  const nq = norm(q);
  const filtered = allStores.filter((store) => {
    if (city && norm(store.city ?? "") !== norm(city)) return false;
    if (sector && !(store.sectors ?? []).some((item) => item.slug === sector)) return false;
    if (nq) {
      const haystack = norm([
        store.name,
        store.description ?? "",
        store.city ?? "",
        store.postalCode ?? "",
        store.nafCode ?? "",
        ...(store.sectors ?? []).flatMap((item) => [item.name, item.slug]),
      ].join(" "));
      if (!haystack.includes(nq)) return false;
    }
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const visibleStores = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = Boolean(q || city || sector);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Boutiques professionnelles Petit Annonces",
    numberOfItems: filtered.length,
    itemListElement: visibleStores.map((store, index) => ({
      "@type": "ListItem",
      position: (page - 1) * PAGE_SIZE + index + 1,
      url: `https://petitannonces.fr/boutique/${store.slug}`,
      name: store.name,
    })),
  };

  return (
    <div className={styles.page}>
      
      <main>
        <section className={styles.hero}>
          <div className={styles.heroGlow} />
          <div className={styles.shell}>
            <div className={styles.heroGrid}>
              <div className={styles.copy}>
                <span className={styles.kicker}><AppIcon name="sparkles" /> Offre de lancement · 90 jours Pro offerts</span>
                <h1>Boutiques et professionnels en France.<br /><em>Ouvrez votre vitrine Pro.</em></h1>
                <p>Publiez vos annonces professionnelles, présentez votre commerce ou votre magasin, importez votre catalogue et centralisez messages, visibilité et activité dans un espace conçu pour vendre plus simplement sur Petit Annonces.</p>
                <div className={styles.actions}>
                  <a className={styles.primary} href="/inscription/pro">Créer ma boutique Pro <AppIcon name="arrow-right" /></a>
                  <a className={styles.secondary} href="#annuaire">Voir les professionnels</a>
                </div>
                <div className={styles.heroMicro}><AppIcon name="shield" /><span><strong>90 jours offerts</strong> · sans carte bancaire · aucun prélèvement automatique à la fin de l’essai.</span></div>
                <div className={styles.proofs}>
                  <span><AppIcon name="user-shield" /> SIRET vérifié</span>
                  <span><AppIcon name="store" /> Boutique publique</span>
                  <span><AppIcon name="list" /> Import catalogue</span>
                  <span><AppIcon name="gauge" /> Pilotage centralisé</span>
                </div>
              </div>
              <div className={styles.mock}>
                <div className={styles.mockTop}><span /><span /><span /><b>Petit Annonces · Espace Pro</b><em>Entreprise vérifiée</em></div>
                <div className={styles.mockBody}>
                  <aside><i>PA</i><small>ESPACE PRO</small><strong>Tableau de bord</strong><strong>Mes annonces</strong><strong>Imports</strong><strong>Messages</strong><strong>Statistiques</strong></aside>
                  <section>
                    <div className={styles.mockHead}><div><small>Bonjour, votre activité en un coup d’œil</small><h3>Tableau de bord Pro</h3></div><button>+ Annonce</button></div>
                    <div className={styles.mockKpis}><div><span>Annonces actives</span><b>48</b></div><div><span>Contacts</span><b>126</b></div><div><span>Vues</span><b>4,8k</b></div></div>
                    <div className={styles.mockChart}><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
                    <div className={styles.mockFooter}><span><AppIcon name="circle-check" /> Catalogue synchronisé</span><b>+18% cette semaine</b></div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.proConversion}>
          <div className={styles.shell}>
            <div className={styles.proConversionHead}>
              <div><span>Conçu pour les professionnels</span><h2>Votre catalogue en ligne, sans perdre du temps.</h2></div>
              <a href="/inscription/pro">Démarrer gratuitement <AppIcon name="arrow-right" /></a>
            </div>
            <div className={styles.proConversionGrid}>
              <article><i><AppIcon name="user-shield" /></i><div><strong>Identité professionnelle vérifiée</strong><p>Présentez votre entreprise avec un SIRET vérifié et une vitrine clairement identifiable.</p></div></article>
              <article><i><AppIcon name="list" /></i><div><strong>Importez votre catalogue</strong><p>Importez vos annonces existantes et gérez votre catalogue depuis un seul espace professionnel.</p></div></article>
              <article><i><AppIcon name="store" /></i><div><strong>Une boutique qui inspire confiance</strong><p>Logo, couverture, activité, ville et annonces sont regroupés dans une page professionnelle dédiée.</p></div></article>
              <article><i><AppIcon name="comments" /></i><div><strong>Contacts centralisés</strong><p>Retrouvez messages, demandes et activité commerciale sans multiplier les outils.</p></div></article>
            </div>
          </div>
        </section>

        <section className={styles.value} aria-labelledby="seo-pro-publish-title">
          <div className={styles.shell}>
            <div className={styles.sectionHead}><span>Publier pour votre activité</span><h2 id="seo-pro-publish-title">Déposer une annonce professionnelle pour un commerce, une boutique ou un magasin.</h2><p>Sur Petit Annonces, les professionnels peuvent publier leurs annonces, structurer leur catalogue et présenter leur activité dans une boutique dédiée. Choisissez la catégorie la plus précise pour apparaître sur des recherches liées à votre métier, votre ville et aux produits ou biens que vous proposez.</p></div>
            <div className={styles.valueGrid}>
              <article><i><AppIcon name="store" /></i><h3>Commerce, boutique & seconde main</h3><p>Présentez votre stock, vos arrivages et vos annonces d’occasion depuis une vitrine professionnelle identifiable.</p><a href="/pro/occasion">Publier pour un commerce d’occasion →</a></article>
              <article><i><AppIcon name="tools" /></i><h3>Matériel de commerce & restauration</h3><p>Déposez des annonces de matériel professionnel dans une catégorie dédiée pour toucher des acheteurs plus qualifiés.</p><a href="/categorie/materiel-commerce-restauration">Voir le matériel professionnel →</a></article>
              <article><i><AppIcon name="home" /></i><h3>Bureaux & locaux commerciaux</h3><p>Publiez vos annonces de bureaux et locaux commerciaux avec les critères immobiliers adaptés et une localisation claire.</p><a href="/categorie/bureaux-commerces">Voir les bureaux et commerces →</a></article>
              <article><i><AppIcon name="car" /></i><h3>Garages & professionnels de l’auto</h3><p>Importez votre parc de véhicules, centralisez vos annonces et dirigez les acheteurs vers votre boutique professionnelle.</p><a href="/pro/automobile">Découvrir l’offre automobile →</a></article>
            </div>
          </div>
        </section>

        <section id="annuaire" className={styles.directory}>
          <div className={styles.shell}>
            <div className={styles.directoryIntro}>
              <div><span>Annuaire professionnel</span><h2>Trouvez une boutique Pro</h2><p>Recherchez par nom, activité, ville ou code postal. Les boutiques affichées possèdent au moins une annonce active.</p></div>
              <div className={styles.directoryCount}><strong>{filtered.length}</strong><span>professionnel{filtered.length > 1 ? "s" : ""}</span></div>
            </div>

            <form className={styles.directoryFilters} action="/professionnels#annuaire" method="get">
              <label className={styles.searchField}><span>Rechercher</span><input name="q" defaultValue={q} placeholder="Nom, activité, code postal…" /></label>
              <label><span>Ville</span><select name="city" defaultValue={city}><option value="">Toute la France</option>{cities.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}</select></label>
              <label><span>Secteur</span><select name="sector" defaultValue={sector}><option value="">Tous les secteurs</option>{sectors.map((item) => <option key={item.slug} value={item.slug}>{item.name} ({item.count})</option>)}</select></label>
              <button type="submit">Rechercher</button>
              {hasFilters && <a className={styles.resetFilters} href="/professionnels#annuaire">Effacer</a>}
            </form>

            {hasFilters && <div className={styles.activeFilters}>
              <span>Filtres actifs :</span>
              {q && <b>“{q}”</b>}
              {city && <b>{city}</b>}
              {sector && <b>{sectors.find((item) => item.slug === sector)?.name ?? sector}</b>}
            </div>}

            {(sectors.length > 0 || cities.length > 0) && <div className={styles.hubLinks}>
              <div><strong>Explorer par secteur</strong><span>{sectors.slice(0,8).map(item => <a key={item.slug} href={`/professionnels/secteur/${item.slug}`}>{item.name}</a>)}</span></div>
              <div><strong>Explorer par ville</strong><span>{cities.slice(0,8).map(([name]) => <a key={name} href={`/professionnels/ville/${slugify(name)}`}>{name}</a>)}</span></div>
            </div>}

            {visibleStores.length > 0 ? <div className={styles.storeGrid}>
              {visibleStores.map((store) => <article className={styles.storeCard} key={store.id}>
                <a className={styles.storeCover} href={`/boutique/${store.slug}`} aria-label={`Voir la boutique ${store.name}`}>
                  <img src={store.coverUrl || DEFAULT_STORE_COVER} alt="" />
                  {store.verified && <span className={styles.verifiedBadge}><AppIcon name="circle-check" /> Vérifié</span>}
                </a>
                <div className={styles.storeBody}>
                  <a className={styles.storeLogo} href={`/boutique/${store.slug}`}><img src={store.logoUrl || DEFAULT_STORE_LOGO} alt={`Logo ${store.name}`} /></a>
                  <div className={styles.storeTitleRow}><div><h3><a href={`/boutique/${store.slug}`}>{store.name}</a></h3><p>{[store.postalCode, store.city].filter(Boolean).join(" ") || "France"}</p></div><strong>{store.activeListings}<span> annonces</span></strong></div>
                  <div className={styles.storeTags}>
                    {store.primarySector && store.city ? <a href={`/professionnels/${store.primarySector.slug}/${slugify(store.city)}`}>{store.primarySector.name} · {store.city}</a> : store.primarySector && <span>{store.primarySector.name}</span>}
                    {store.siretVerified && <span className={styles.siretTag}>SIRET vérifié</span>}
                  </div>
                  {store.description && <p className={styles.storeDescription}>{store.description}</p>}
                  <div className={styles.storeFooter}><span>{store.sectors?.length > 1 ? `${store.sectors.length} secteurs` : store.primarySector?.name ?? "Professionnel"}</span><a href={`/boutique/${store.slug}`}>Voir la boutique <AppIcon name="arrow-right" /></a></div>
                </div>
              </article>)}
            </div> : <div className={styles.emptyDirectory}><i><AppIcon name="store" /></i><h3>Aucun professionnel ne correspond à votre recherche.</h3><p>Essayez une autre ville, un autre secteur ou supprimez les filtres.</p><a href="/professionnels#annuaire">Voir tous les professionnels</a></div>}

            {pageCount > 1 && <nav className={styles.pagination} aria-label="Pagination de l’annuaire">
              {page > 1 && <a href={directoryUrl({ q, city, sector, page: page - 1 })}>← Précédent</a>}
              <span>Page {page} sur {pageCount}</span>
              {page < pageCount && <a href={directoryUrl({ q, city, sector, page: page + 1 })}>Suivant →</a>}
            </nav>}

            <div className={styles.directoryCta}><div><span>Vous êtes professionnel ?</span><h3>Déposez vos annonces et ouvrez votre boutique Pro.</h3><p>Créez votre vitrine professionnelle, publiez vos annonces en France et profitez de l’offre de lancement avec 90 jours Pro offerts.</p></div><a href="/inscription/pro">Créer ma boutique Pro <AppIcon name="arrow-right" /></a></div>
          </div>
        </section>

        <section className={styles.value}>
          <div className={styles.shell}>
            <div className={styles.sectionHead}><span>Une présence professionnelle complète</span><h2>Tout ce qu’il faut pour vendre avec une image plus sérieuse.</h2></div>
            <div className={styles.valueGrid}>
              <article><i><AppIcon name="store" /></i><h3>Votre boutique publique</h3><p>Logo, couverture, coordonnées, annonces et identité professionnelle réunis dans une vitrine dédiée.</p></article>
              <article><i><AppIcon name="gauge" /></i><h3>Un espace de pilotage</h3><p>Suivez vos annonces, vos ventes, vos messages, vos mises en avant et l’état de votre activité.</p></article>
              <article><i><AppIcon name="sparkles" /></i><h3>Plus de visibilité</h3><p>Activez des options de mise en avant aux tarifs affichés directement en euros.</p></article>
              <article><i><AppIcon name="user-shield" /></i><h3>Crédibilité renforcée</h3><p>Présentez clairement votre entreprise et accédez aux mécanismes de vérification professionnelle.</p></article>
            </div>
          </div>
        </section>

        <section className={styles.value}>
          <div className={styles.shell}>
            <div className={styles.sectionHead}><span>Solutions par métier</span><h2>Commencez avec une page pensée pour votre secteur.</h2><p>Chaque parcours conserve l’offre de lancement de 90 jours et l’import en masse, avec un message adapté à votre activité.</p></div>
            <div className={styles.valueGrid}>
              <article><i><AppIcon name="car" /></i><h3>Garages & concessions</h3><p>Importez votre parc automobile et regroupez vos véhicules dans une vitrine vérifiée.</p><a href="/pro/automobile">Découvrir l’offre automobile →</a></article>
              <article><i><AppIcon name="home" /></i><h3>Agences immobilières</h3><p>Diffusez ventes et locations depuis une identité professionnelle unique.</p><a href="/pro/immobilier">Découvrir l’offre immobilier →</a></article>
              <article><i><AppIcon name="laptop" /></i><h3>Téléphonie & informatique</h3><p>Mettez smartphones, ordinateurs, consoles et accessoires en ligne plus rapidement.</p><a href="/pro/high-tech">Découvrir l’offre high-tech →</a></article>
              <article><i><AppIcon name="store" /></i><h3>Commerces d’occasion</h3><p>Publiez un catalogue multicarte pour la seconde main, le dépôt-vente ou la brocante.</p><a href="/pro/occasion">Découvrir l’offre seconde main →</a></article>
            </div>
          </div>
        </section>

        <section id="tarifs" className={styles.pricing}>
          <div className={styles.shell}>
            <div className={styles.sectionHead}><span>Tarifs professionnels</span><h2>Choisissez l’offre adaptée à votre activité.</h2><p>Les tarifs ci-dessous sont gérés depuis l’administration Petit Annonces et peuvent évoluer selon les services activés.</p></div>
            <div className={styles.cards}>{ps.map((p, index) => <article className={`${styles.plan} ${index === 1 ? styles.featured : ""}`} key={p.id}>{index === 1 && <div className={styles.popular}>Le plus choisi</div>}<span className={styles.planCode}>{p.code}</span><h3>{p.name}</h3><p>{p.description ?? "Une formule professionnelle pour développer votre présence."}</p><div className={styles.price}><strong>{euro(p.monthlyPriceMinor, p.currency)}</strong><span>/ mois</span></div>{p.yearlyPriceMinor && <small className={styles.year}>ou {euro(p.yearlyPriceMinor, p.currency)} / an</small>}<a className={styles.planButton} href={`/inscription/pro?plan=${encodeURIComponent(p.code)}`}>Choisir {p.name}</a><ul>{features(p).map(([label, value]) => <li key={label}><span>{value === "—" ? "—" : "✓"}</span><div><strong>{label}</strong><small>{value}</small></div></li>)}</ul></article>)}</div>
            <div className={styles.note}><AppIcon name="info" /><p>La création du compte professionnel et de la fiche entreprise est distincte de l’activation d’une formule payante. Les paiements d’abonnement seront proposés uniquement lorsqu’un moyen de paiement compatible est configuré.</p></div>
          </div>
        </section>

        <section className={styles.cta}><div className={styles.shell}><div><span>Passez à une présence professionnelle</span><h2>Créez votre vitrine et commencez à structurer vos ventes.</h2></div><a href="/inscription/pro">Créer mon compte professionnel <AppIcon name="arrow-right" /></a></div></section>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      </main>
      
    </div>
  );
}
