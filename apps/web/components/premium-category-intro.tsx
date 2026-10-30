import { AppIcon } from "./app-icon";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBed, faBolt, faBuilding, faCar, faCity, faHouse, faKey,
  faMotorcycle, faSailboat, faScrewdriverWrench, faSquareParking,
  faTree, faTruck, faVanShuttle, faWarehouse,
} from "@fortawesome/free-solid-svg-icons";
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

function symbol(slug:string,name:string,property:boolean):IconDefinition{
  const value=(slug+" "+name).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  if(property){
    if(/location|louer|colocation/.test(value))return faKey;
    if(/appartement|studio/.test(value))return faBuilding;
    if(/maison|villa|pavillon/.test(value))return faHouse;
    if(/terrain|jardin|parcelle/.test(value))return faTree;
    if(/bureau|commerce|boutique|local/.test(value))return faCity;
    if(/parking|stationnement|garage/.test(value))return faSquareParking;
    if(/chambre/.test(value))return faBed;
    if(/entrepot|hangar/.test(value))return faWarehouse;
    return faHouse;
  }
  if(/moto|scooter|deux-roues|quad/.test(value))return faMotorcycle;
  if(/camping|caravane|van|fourgon/.test(value))return faVanShuttle;
  if(/bateau|nautisme|voilier/.test(value))return faSailboat;
  if(/piece|accessoire|entretien/.test(value))return faScrewdriverWrench;
  if(/electrique|hybride/.test(value))return faBolt;
  if(/utilitaire|camion|poids-lourd/.test(value))return faTruck;
  return faCar;
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
          <a href="/deposer-annonce-gratuite">Déposer une annonce gratuite <AppIcon name="plus"/></a>
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
          <i aria-hidden="true"><FontAwesomeIcon icon={symbol(item.slug,item.name,property)}/></i>
          <strong>{item.name}</strong>
          <span>Découvrir <AppIcon name="arrow-right"/></span>
        </a>
      )}</div>
    </section>}
  </>;
}
