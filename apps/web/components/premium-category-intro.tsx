import { AppIcon } from "./app-icon";
import styles from "./premium-category-intro.module.css";

type CategoryLink={name:string;slug:string};
type Props={
  name:string;
  slug:string;
  domain:string;
  intro:string;
  total:number;
  related:CategoryLink[];
};

function symbol(slug:string,property:boolean){
  if(property){
    if(/location|colocation/.test(slug))return "🔑";
    if(/vente|maison|villa/.test(slug))return "🏡";
    if(/terrain/.test(slug))return "🌿";
    if(/bureau|commerce/.test(slug))return "🏢";
    if(/parking|garage/.test(slug))return "🚘";
    return "🏠";
  }
  if(/moto|scooter/.test(slug))return "🏍️";
  if(/camping|caravane/.test(slug))return "🚐";
  if(/nautisme/.test(slug))return "⛵";
  if(/piece|accessoire/.test(slug))return "🛠️";
  if(/electrique|hybride/.test(slug))return "⚡";
  if(/utilitaire/.test(slug))return "🚚";
  if(/suv|cross/.test(slug))return "🚙";
  return "🚗";
}

export function PremiumCategoryIntro({name,slug,domain,intro,total,related}:Props){
  const property=domain==="REAL_ESTATE";
  const title=slug==="immobilier"?"Immobilier : trouvez votre prochain bien":
    slug==="vehicules"?"Véhicules d’occasion : trouvez le vôtre":
    slug==="voitures"?"Voitures d’occasion : trouvez la vôtre":name+" en France";
  const parent=property?"/categorie/immobilier":"/categorie/vehicules";
  return <>
    <section className={[styles.hero,property?styles.property:styles.vehicle].join(" ")} aria-label={property?"Rechercher un bien immobilier":"Rechercher un véhicule"}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}><AppIcon name={property?"home":"car"}/></span>
          <span><small>PETIT ANNONCES</small><strong>{property?"Immobilier":"Automobile"}</strong></span>
        </div>
        <div className={styles.intro}>
          <span>{property?"Vente, location & nouveaux projets":"Occasions, modèles & belles découvertes"}</span>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
        <form action="/recherche" method="get" className={styles.search}>
          <input type="hidden" name="category" value={slug}/>
          <label><span>{property?"Votre projet immobilier":"Votre recherche automobile"}</span><div><AppIcon name={property?"home":"car"}/><input name="q" aria-label={property?"Type de bien":"Marque ou modèle"} placeholder={property?"Appartement, maison, terrain…":"Marque, modèle, véhicule…"}/></div></label>
          <label><span>Localisation</span><div><AppIcon name="location"/><input name="city" aria-label="Ville ou code postal" placeholder="Ville ou code postal"/></div></label>
          <label><span>Budget maximum</span><div><AppIcon name="wallet"/><input type="number" name="maxPrice" min="0" step="1" aria-label="Budget maximum en euros" placeholder="Prix max. €"/></div></label>
          <button type="submit"><AppIcon name="search"/>Rechercher</button>
        </form>
        <div className={styles.assurance}>
          <span><AppIcon name="location"/>Partout en France</span>
          <span><AppIcon name="list"/>Filtres adaptés</span>
          <span><AppIcon name="shield"/>Annonces modérées</span>
          <a href="#annonces">{total.toLocaleString("fr-FR")} annonce{total>1?"s":""} <AppIcon name="arrow-right"/></a>
        </div>
      </div>
    </section>
    {related.length>0&&<section className={styles.explore} aria-label={property?"Types de biens":"Types de véhicules"}>
      <div className={styles.exploreHead}>
        <div><span>EXPLORER</span><h2>{property?"Quel type de bien recherchez-vous ?":"Quel véhicule recherchez-vous ?"}</h2></div>
        <a href={parent}>Tout voir <AppIcon name="arrow-right"/></a>
      </div>
      <div className={styles.types}>{related.slice(0,8).map((item)=>
        <a key={item.slug} href={"/categorie/"+item.slug} className={item.slug===slug?styles.current:""} aria-current={item.slug===slug?"page":undefined}>
          <i aria-hidden="true">{symbol(item.slug,property)}</i>
          <strong>{item.name}</strong>
          <span>Découvrir <AppIcon name="arrow-right"/></span>
        </a>
      )}</div>
    </section>}
  </>;
}
