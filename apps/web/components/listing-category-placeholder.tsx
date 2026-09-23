import { AppIcon, type AppIconName } from "./app-icon";
import styles from "./listing-category-placeholder.module.css";

type CategoryLike={name?:string|null;slug?:string|null;domain?:string|null};
type PlaceholderMeta={key:string;label:string;icon:AppIconName;image?:string};

function normalise(value:string|null|undefined){return (value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()}

export function listingPlaceholderMeta(category:CategoryLike):PlaceholderMeta{
  const domain=(category.domain??"").toUpperCase();
  const text=normalise(`${category.slug??""} ${category.name??""}`);
  if(domain==="JOB"||/\b(emploi|job|travail|recrut)/.test(text))return{key:"emploi",label:"Emploi",icon:"briefcase",image:"/placeholders/emploi.webp"};
  if(domain==="REAL_ESTATE"||/(immobilier|maison|appartement|terrain|parking|garage|bureau)/.test(text))return{key:"immobilier",label:"Immobilier",icon:"home"};
  if(domain==="VEHICLE"||/(vehicule|voiture|auto|moto|scooter|utilitaire|caravane)/.test(text))return{key:"vehicules",label:"Véhicules",icon:"car"};
  if(domain==="SERVICE"||/(service|reparation|cours|baby.?sitting|covoiturage)/.test(text))return{key:"services",label:"Services",icon:"tools"};
  if(/(vacance|hotel|hebergement|gite|camping)/.test(text))return{key:"vacances",label:"Vacances",icon:"calendar"};
  if(/(high.?tech|electron|telephone|smartphone|ordinateur|tablette|console|photo|audio|video|informatique)/.test(text))return{key:"electronique",label:"Électronique",icon:"laptop"};
  if(/(mode|vetement|chaussure|sac|bijou|montre)/.test(text))return{key:"mode",label:"Mode",icon:"shirt"};
  if(/(maison|jardin|meuble|decoration|bricolage|electromenager|linge)/.test(text))return{key:"maison-jardin",label:"Maison & Jardin",icon:"couch"};
  if(domain==="ANIMAL"||/(animal|chien|chat)/.test(text))return{key:"animaux",label:"Animaux",icon:"paw"};
  if(/(enfant|bebe|jouet)/.test(text))return{key:"enfants",label:"Enfants & Bébé",icon:"child"};
  return{key:"autres",label:category.name?.trim()||"Petit Annonces",icon:"box"};
}

export function ListingCategoryPlaceholder({category,variant="card",className=""}:{category:CategoryLike;variant?:"card"|"hero";className?:string}){
  const meta=listingPlaceholderMeta(category);
  if(meta.image)return <span className={`${styles.root} ${styles[meta.key]??""} ${variant==="hero"?styles.hero:styles.card} ${className}`} aria-label={`${meta.label} — annonce sans photo`}><img className={styles.generatedImage} src={meta.image} alt={`${meta.label} — annonce sans photo`}/></span>;
  return <span className={`${styles.root} ${styles[meta.key]??""} ${variant==="hero"?styles.hero:styles.card} ${className}`} aria-label={`${meta.label} — annonce sans photo`}>
    <span className={styles.brand}><img src="/pwa-loading-logo.svg" alt="" aria-hidden="true"/></span>
    <span className={styles.art}><AppIcon name={meta.icon}/></span>
    <strong>{meta.label}</strong>
    <small>Annonce sans photo</small>
  </span>;
}
