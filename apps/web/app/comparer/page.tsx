import type { Metadata } from "next";
import { AppIcon } from "../../components/app-icon";
import { formatListingPrice } from "../../lib/listing-price";
import styles from "./page.module.css";

export const metadata:Metadata={title:"Comparer des annonces",description:"Comparez jusqu’à 4 annonces Petit Annonces côte à côte.",robots:{index:false,follow:true}};

type SearchParams=Promise<Record<string,string|string[]|undefined>>;
type Attribute={key:string;label:string;unit:string|null;value:unknown};
type CompareItem={
 id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;postalCode:string|null;publishedAt:string|null;imageUrl:string|null;
 category:{id:string;name:string;slug:string;domain:string};breadcrumb:Array<{name:string;slug:string}>;attributes:Attribute[];
 vehicle:Record<string,unknown>|null;property:Record<string,unknown>|null;energy:Record<string,unknown>|null;
 commerce:{securePaymentEnabled:boolean;shippingEnabled:boolean;handDeliveryEnabled:boolean};
 seller:{id:string;name:string;kind:string;verified:boolean;trust:{score?:number;level?:string;reliableSeller?:boolean}|null;reviewCount:number;reviewAverage:number|null;completedSales:number};
};
type Payload={items:CompareItem[];missingIds:string[];maxItems:number};
type Row={label:string;values:Array<unknown>;unit?:string|null};

const api=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;

function cleanIds(raw:string){return [...new Set(raw.split(",").map(value=>value.trim()).filter(Boolean))].slice(0,4)}
async function loadItems(ids:string[]):Promise<Payload>{
 if(ids.length<1)return{items:[],missingIds:[],maxItems:4};
 try{const r=await fetch(`${api()}/public/compare-listings?ids=${encodeURIComponent(ids.join(","))}`,{cache:"no-store"});if(!r.ok)return{items:[],missingIds:ids,maxItems:4};return r.json() as Promise<Payload>}catch{return{items:[],missingIds:ids,maxItems:4}}
}
function isPresent(value:unknown){if(value===null||value===undefined||value==="")return false;if(Array.isArray(value))return value.length>0;return true}
function text(value:unknown,unit?:string|null){
 if(!isPresent(value))return "—";
 if(typeof value==="boolean")return value?"Oui":"Non";
 if(Array.isArray(value))return value.map(item=>String(item)).join(", ");
 if(typeof value==="object")return "—";
 const raw=typeof value==="number"?new Intl.NumberFormat("fr-FR",{maximumFractionDigits:2}).format(value):String(value);
 return unit?`${raw} ${unit}`:raw;
}
function date(value:string|null){if(!value)return"—";try{return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(value))}catch{return"—"}}
function attr(item:CompareItem,key:string){return item.attributes.find(a=>a.key===key)?.value}
function vehicleValue(item:CompareItem,key:string){return item.vehicle?.[key]}
function propertyValue(item:CompareItem,key:string){return item.property?.[key]}
function energyValue(item:CompareItem,key:string){return item.energy?.[key]}
function rowsWithValues(rows:Row[]){return rows.filter(row=>row.values.some(isPresent))}
function domainRows(items:CompareItem[]){
 const hasVehicle=items.some(item=>item.category.domain==="VEHICLE");
 const hasProperty=items.some(item=>item.category.domain==="REAL_ESTATE");
 const sections:Array<{title:string;rows:Row[]}>=[];
 if(hasVehicle)sections.push({title:"Véhicule",rows:rowsWithValues([
  {label:"Marque",values:items.map(i=>vehicleValue(i,"make")??attr(i,"brand"))},
  {label:"Modèle",values:items.map(i=>vehicleValue(i,"model")??attr(i,"model"))},
  {label:"Version",values:items.map(i=>vehicleValue(i,"version"))},
  {label:"Année",values:items.map(i=>vehicleValue(i,"modelYear"))},
  {label:"Kilométrage",unit:"km",values:items.map(i=>vehicleValue(i,"mileageKm"))},
  {label:"Carburant",values:items.map(i=>vehicleValue(i,"fuel"))},
  {label:"Boîte de vitesse",values:items.map(i=>vehicleValue(i,"transmission"))},
  {label:"Carrosserie",values:items.map(i=>vehicleValue(i,"bodyType"))},
  {label:"Puissance",unit:"kW",values:items.map(i=>vehicleValue(i,"powerKw"))},
  {label:"Puissance fiscale",unit:"CV",values:items.map(i=>vehicleValue(i,"fiscalPowerCv"))},
  {label:"Portes",values:items.map(i=>vehicleValue(i,"doors"))},
  {label:"Places",values:items.map(i=>vehicleValue(i,"seats"))},
  {label:"Couleur",values:items.map(i=>vehicleValue(i,"color"))},
  {label:"CO₂",unit:"g/km",values:items.map(i=>vehicleValue(i,"co2GKm"))},
 ])});
 if(hasProperty)sections.push({title:"Immobilier",rows:rowsWithValues([
  {label:"Transaction",values:items.map(i=>{const v=propertyValue(i,"transactionType");return v==="SALE"?"Vente":v==="RENTAL"?"Location":v})},
  {label:"Type de bien",values:items.map(i=>propertyValue(i,"propertyType"))},
  {label:"Surface",unit:"m²",values:items.map(i=>propertyValue(i,"surfaceM2"))},
  {label:"Pièces",values:items.map(i=>propertyValue(i,"rooms"))},
  {label:"Chambres",values:items.map(i=>propertyValue(i,"bedrooms"))},
  {label:"Meublé",values:items.map(i=>propertyValue(i,"furnished"))},
  {label:"Étage",values:items.map(i=>propertyValue(i,"floor"))},
  {label:"Étages bâtiment",values:items.map(i=>propertyValue(i,"totalFloors"))},
  {label:"Terrain",unit:"m²",values:items.map(i=>propertyValue(i,"landM2"))},
  {label:"DPE",values:items.map(i=>energyValue(i,"energyClass"))},
  {label:"GES",values:items.map(i=>energyValue(i,"climateClass"))},
  {label:"Consommation",unit:"kWh/m²/an",values:items.map(i=>energyValue(i,"energyConsumptionKwhM2Year"))},
 ])});
 return sections;
}
function dynamicRows(items:CompareItem[]){
 const definitions=new Map<string,{label:string;unit:string|null}>();
 for(const item of items)for(const a of item.attributes)if(a.key&&a.label&&!definitions.has(a.key))definitions.set(a.key,{label:a.label,unit:a.unit});
 const excluded=new Set(["brand","model","mileage","fuel","gearbox","fiscalPower","powerKw","seats","doors","color","bodyStyle"]);
 return rowsWithValues([...definitions.entries()].filter(([key])=>!excluded.has(key)).slice(0,18).map(([key,meta])=>({label:meta.label,unit:meta.unit,values:items.map(item=>attr(item,key))})));
}

export default async function ComparePage({searchParams}:{searchParams:SearchParams}){
 const params=await searchParams;const ids=cleanIds(one(params.ids)??"");const data=await loadItems(ids);const items=data.items;
 if(items.length<2)return <div className={styles.page}><main className={styles.shell}><section className={styles.empty}><span><AppIcon name="list"/></span><h1>Comparez vos annonces préférées</h1><p>Sélectionnez au moins 2 annonces avec le bouton « Comparer ». Vous pouvez en comparer jusqu’à 4.</p><a href="/recherche"><AppIcon name="search"/>Trouver des annonces</a></section></main></div>;
 const columns=`170px repeat(${items.length},minmax(210px,1fr))`;
 const commonRows:Row[]=[
  {label:"Prix",values:items.map(item=>formatListingPrice(item.priceMinor,item.currency,{domain:item.category.domain,transactionType:String(item.property?.transactionType??"")||null}))},
  {label:"Localisation",values:items.map(item=>[item.postalCode,item.city].filter(Boolean).join(" ")||"France")},
  {label:"Catégorie",values:items.map(item=>item.category.name)},
  {label:"Publié le",values:items.map(item=>date(item.publishedAt))},
  {label:"Vendeur",values:items.map(item=>item.seller.name)},
  {label:"Compte",values:items.map(item=>item.seller.kind==="PROFESSIONNEL"?"Professionnel":"Particulier")},
  {label:"Profil vérifié",values:items.map(item=>item.seller.verified)},
  {label:"Score de confiance",unit:"/100",values:items.map(item=>item.seller.trust?.score)},
  {label:"Avis vendeur",values:items.map(item=>item.seller.reviewAverage==null?null:`${item.seller.reviewAverage.toFixed(1)}/5 · ${item.seller.reviewCount} avis`)},
  {label:"Ventes finalisées",values:items.map(item=>item.seller.completedSales)},
  {label:"Paiement sécurisé",values:items.map(item=>item.commerce.securePaymentEnabled)},
  {label:"Livraison",values:items.map(item=>item.commerce.shippingEnabled)},
  {label:"Remise en main propre",values:items.map(item=>item.commerce.handDeliveryEnabled)},
 ];
 const sections=domainRows(items);const extras=dynamicRows(items);if(extras.length)sections.push({title:"Caractéristiques",rows:extras});
 const row=(r:Row,key:string)=><div className={styles.row} style={{gridTemplateColumns:columns}} key={key}><strong className={styles.label}>{r.label}</strong>{r.values.map((value,index)=><div className={styles.value} key={`${key}-${items[index]?.id??index}`}>{text(value,r.unit)}</div>)}</div>;
 return <div className={styles.page}><main className={styles.shell}>
  <header className={styles.hero}><div><span>Comparateur Petit Annonces</span><h1>Comparez {items.length} annonces côte à côte</h1><p>Prix, caractéristiques, localisation et signaux de confiance réunis dans une seule vue.</p></div><a href="/recherche"><AppIcon name="plus"/>Ajouter une autre annonce</a></header>
  {data.missingIds.length>0&&<div className={styles.notice}>{data.missingIds.length} annonce{data.missingIds.length>1?"s ne sont":" n’est"} plus disponible{data.missingIds.length>1?"s":""} et {data.missingIds.length>1?"ont":"a"} été retirée{data.missingIds.length>1?"s":""} de la comparaison.</div>}
  <div className={styles.scroll}><section className={styles.matrix} style={{minWidth:`${170+items.length*210}px`}}>
   <div className={styles.headRow} style={{gridTemplateColumns:columns}}><div className={styles.corner}><AppIcon name="list"/><strong>Annonce</strong></div>{items.map(item=><article className={styles.product} key={item.id}>{item.imageUrl?<img src={item.imageUrl} alt={item.title??item.category.name}/>:<div className={styles.noImage}><AppIcon name="image"/></div>}<small>{item.category.name}</small><h2>{item.title??item.category.name}</h2><strong>{formatListingPrice(item.priceMinor,item.currency,{domain:item.category.domain,transactionType:String(item.property?.transactionType??"")||null})}</strong><span><AppIcon name="location"/>{item.city??"France"}</span>{item.slug?<a href={`/annonce/${item.slug}`}>Voir l’annonce <AppIcon name="arrow-right"/></a>:<span/>}</article>)}</div>
   <section className={styles.section}><h2>Informations principales</h2>{commonRows.map((r,index)=>row(r,`common-${index}`))}</section>
   {sections.map((section,sectionIndex)=><section className={styles.section} key={`${section.title}-${sectionIndex}`}><h2>{section.title}</h2>{section.rows.map((r,index)=>row(r,`${section.title}-${index}`))}</section>)}
  </section></div>
  <section className={styles.help}><AppIcon name="info"/><div><strong>Les informations proviennent des annonces publiées.</strong><p>Vérifiez toujours les détails avec le vendeur avant une transaction, notamment l’état réel, les documents et les conditions de livraison.</p></div></section>
 </main></div>;
}
