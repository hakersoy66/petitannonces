import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../../components/site-header";
import { attributeToText, fetchPublicListing, formatMoney } from "../../../lib/public-listing";
import styles from "./page.module.css";

type Props = { params: Promise<{ slug: string }> };

function vehicleSpecs(vehicle: Record<string, unknown> | null) {
  if (!vehicle) return [];
  const pairs = [
    ["Marque", vehicle.make], ["Modèle", vehicle.model], ["Version", vehicle.version], ["Année", vehicle.modelYear],
    ["Kilométrage", vehicle.mileageKm, "km"], ["Carburant", vehicle.fuel], ["Boîte", vehicle.transmission],
    ["Puissance", vehicle.powerKw, "kW"], ["Puissance fiscale", vehicle.fiscalPowerCv, "CV"], ["CO₂", vehicle.co2GKm, "g/km"],
  ] as const;
  return pairs.filter(([, value]) => value !== null && value !== undefined).map(([label, value, unit]) => ({ label, value: attributeToText(value, unit) }));
}

function propertySpecs(property: Record<string, unknown> | null, energy: Record<string, unknown> | null) {
  if (!property) return [];
  const pairs = [
    ["Type de bien", property.propertyType], ["Surface", property.surfaceM2, "m²"], ["Pièces", property.rooms], ["Chambres", property.bedrooms],
    ["Étage", property.floor], ["Meublé", property.furnished], ["DPE", energy?.energyClass], ["GES", energy?.climateClass],
  ] as const;
  return pairs.filter(([, value]) => value !== null && value !== undefined).map(([label, value, unit]) => ({ label, value: attributeToText(value, unit) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const listing = await fetchPublicListing(slug);
    if (!listing) return { title: "Annonce introuvable | Petit Annonces" };
    return {
      title: `${listing.title ?? listing.category.name} | Petit Annonces`,
      description: listing.description?.slice(0, 155) ?? `Consultez cette annonce ${listing.category.name.toLowerCase()} sur Petit Annonces.`,
      alternates: { canonical: `/annonce/${slug}` },
    };
  } catch {
    return { title: "Petit Annonces" };
  }
}

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  let listing;
  try { listing = await fetchPublicListing(slug); } catch { listing = null; }
  if (!listing) notFound();

  const isVehicle = listing.category.domain === "VEHICLE";
  const isProperty = listing.category.domain === "REAL_ESTATE";
  const title = listing.title ?? listing.category.name;
  const price = formatMoney(listing.priceMinor, listing.currency);
  const location = [listing.city, listing.postalCode].filter(Boolean).join(" ") || listing.region || "France";
  const specs = isVehicle
    ? vehicleSpecs(listing.vehicle)
    : isProperty
      ? propertySpecs(listing.property, listing.energy)
      : listing.attributes.map((item) => ({ label: item.label, value: attributeToText(item.value, item.unit) }));

  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.shell}>
        <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">Accueil › {listing.breadcrumb.map((item) => item.name).join(" › ")} › {title}</nav>
        <div className={styles.layout}>
          <section className={styles.main}>
            <div className={styles.gallery}>
              <div className={styles.heroImage}>Photo principale<span className={styles.photoBadge}>Galerie</span></div>
              <div className={styles.thumbs}><div className={styles.thumb}>Photo 2</div><div className={styles.thumb}>Photo 3</div><div className={styles.thumb}>+</div></div>
            </div>

            <div className={styles.topline}>
              <div className={styles.titleBlock}>
                <h1>{title}</h1>
                <div className={styles.meta}><span>📍 {location}</span>{listing.publishedAt && <span>🕒 {new Intl.DateTimeFormat("fr-FR").format(new Date(listing.publishedAt))}</span>}</div>
              </div>
              <div className={styles.actions}><button className={styles.iconBtn}>♡</button><button className={styles.iconBtn}>↗</button></div>
            </div>

            {specs.length > 0 && <section className={styles.card}><h2>{isVehicle ? "Caractéristiques du véhicule" : isProperty ? "Caractéristiques du bien" : "Caractéristiques"}</h2><div className={styles.specGrid}>{specs.map((spec) => <div className={styles.spec} key={spec.label}><small>{spec.label}</small><strong>{spec.value}</strong></div>)}</div></section>}

            {isProperty && listing.energy && <section className={styles.card}><h2>Performance énergétique</h2><div className={styles.deliveryRows}><div className={styles.deliveryRow}><span>DPE</span><strong>{attributeToText(listing.energy.energyClass)}</strong></div><div className={styles.deliveryRow}><span>GES</span><strong>{attributeToText(listing.energy.climateClass)}</strong></div>{listing.energy.annualCostMinMinor != null && listing.energy.annualCostMaxMinor != null && <div className={styles.deliveryRow}><span>Dépenses annuelles estimées</span><strong>{formatMoney(Number(listing.energy.annualCostMinMinor))} – {formatMoney(Number(listing.energy.annualCostMaxMinor))}</strong></div>}</div></section>}

            <section className={styles.card}><h2>Description</h2><p className={styles.description}>{listing.description ?? "Aucune description fournie."}</p></section>
            <section className={styles.card}><h2>Localisation</h2><div className={styles.locationBox}>Zone approximative · {location}</div></section>
            <section className={styles.card}><h2>À propos de l’annonceur</h2><div className={styles.sellerMini}><div className={styles.avatar}>{listing.seller.name.slice(0, 2).toUpperCase()}</div><div><strong>{listing.seller.name}</strong><div className={styles.meta}><span>{listing.seller.kind === "PROFESSIONNEL" ? "Professionnel" : "Particulier"}</span>{listing.seller.verified && <span>✓ Vérifié</span>}</div></div></div></section>
          </section>

          <aside className={styles.sidebar}>
            <div className={styles.priceCard}><div className={styles.priceLabel}>{isProperty ? "Prix" : "Prix"}</div><div className={styles.price}>{price}</div><button className={styles.primary}>{isProperty ? "Demander une visite" : isVehicle ? "Contacter le vendeur" : "Acheter en toute sécurité"}</button><button className={styles.secondary}>Envoyer un message</button>{!isProperty && <button className={styles.ghost}>Faire une offre</button>}<div className={styles.secure}>{isVehicle ? "🚘 Vérifiez les documents et organisez l’essai avant la transaction." : isProperty ? "🏠 Vérifiez diagnostics et informations du bien avant engagement." : "🔒 Paiement protégé lorsque la transaction Petit Annonces est disponible."}</div></div>
            <div className={styles.sellerCard}><div className={styles.sellerHead}><div className={styles.avatar}>{listing.seller.name.slice(0, 2).toUpperCase()}</div><div><strong>{listing.seller.name}</strong><div className={styles.meta}>{listing.seller.verified && <span>Vérifié</span>}</div></div></div><button className={styles.ghost}>Voir le profil</button></div>
          </aside>
        </div>
      </main>
      <div className={styles.mobileBar}><div className={styles.mobileBarInner}><div><small>Prix</small><strong>{price}</strong></div><button>{isProperty ? "Contacter" : isVehicle ? "Message" : "Acheter"}</button></div></div>
    </div>
  );
}
