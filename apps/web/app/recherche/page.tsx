import { CatalogFilterPanel } from "../../components/catalog-filter-panel";
import { SiteHeader } from "../../components/site-header";
import styles from "./page.module.css";

type SearchParams=Promise<Record<string,string|string[]|undefined>>;
type SearchItem={id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;publishedAt:string|null;createdAt:string;category:{name:string;slug:string};vehicle?:{modelYear?:number|null;mileageKm?:number|null;fuel?:string|null}|null;property?:{surfaceM2?:number|null;rooms?:number|null}|null;imageUrl:string|null;sellerReputation:{verified:boolean;reviewCount:number;reviewAverage:number|null;completedSales:number;trust:{score:number;reliableSeller:boolean;level:"NEW"|"ESTABLISHED"|"TRUSTED"}}};
type SearchPayload={total:number;items:SearchItem[]};
const base=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
const one=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v;
const money=(v:number|null,c="EUR")=>v==null?"Prix sur demande":new Intl.NumberFormat("fr-FR",{style:"currency",currency:c,maximumFractionDigits:v%100===0?0:2}).format(v/100);
function meta(item:SearchItem){if(item.vehicle)return [item.vehicle.modelYear,item.vehicle.mileageKm!=null?`${item.vehicle.mileageKm.toLocaleString("fr-FR")} km`:null,item.vehicle.fuel].filter(Boolean).join(" · ");if(item.property)return [item.property.surfaceM2!=null?`${item.property.surfaceM2} m²`:null,item.property.rooms!=null?`${item.property.rooms} pièces`:null].filter(Boolean).join(" · ");return item.category.name;}
function age(date:string|null){if(!date)return "Annonce récente";const ms=Date.now()-new Date(date).getTime();const hours=Math.max(1,Math.floor(ms/3600000));if(hours<24)return `Il y a ${hours} h`;const days=Math.floor(hours/24);return days===1?"Hier":`Il y a ${days} j`;}

async function search(params:Record<string,string|string[]|undefined>):Promise<SearchPayload>{const qs=new URLSearchParams();for(const key of ["q","category","city","minPrice","maxPrice","page"]){const value=one(params[key]);if(value)qs.set(key,value);}qs.set("limit","24");const r=await fetch(`${base()}/search?${qs.toString()}`,{next:{revalidate:30}});if(!r.ok)return{total:0,items:[]};return r.json();}

export default async function SearchPage({searchParams}:{searchParams:SearchParams}) {
  const params=await searchParams;const data=await search(params);const q=one(params.q)??"";const city=one(params.city)??"";
  return <div className={styles.page}><SiteHeader/><main className={styles.shell}>
    <header className={styles.hero}><div><p className={styles.eyebrow}>Explorer Petit Annonces</p><h1>Trouvez exactement ce que vous cherchez.</h1><p>Des annonces réelles avec réputation vendeur et évaluations après transaction.</p></div><form action="/recherche" method="get" className={styles.searchbar}><input name="q" defaultValue={q} placeholder="Que recherchez-vous ?" aria-label="Recherche"/><input name="city" defaultValue={city} placeholder="Ville ou code postal" aria-label="Ville"/><button type="submit">Rechercher</button></form></header>
    <div className={styles.layout}><CatalogFilterPanel/><section className={styles.results}><div className={styles.toolbar}><div><b>{data.total.toLocaleString("fr-FR")} annonce{data.total>1?"s":""}</b><span> trouvée{data.total>1?"s":""}</span></div></div>
      <div className={styles.suggestions}><span>Repères</span><span className={styles.legendBadge}>★ Avis après transaction</span><span className={styles.legendReliable}>✓ Vendeur fiable</span></div>
      {!data.items.length?<div className={styles.empty}>Aucune annonce ne correspond à votre recherche pour le moment.</div>:<div className={styles.grid}>{data.items.map(item=><a className={styles.card} key={item.id} href={item.slug?`/annonce/${item.slug}`:"#"}><div className={styles.image}>{item.imageUrl?<img src={item.imageUrl} alt={item.title??item.category.name}/>:<span>📦</span>}<span className={styles.favorite} aria-hidden="true">♡</span>{item.sellerReputation.trust.reliableSeller&&<em className={styles.reliable}>✓ Vendeur fiable</em>}</div><div className={styles.cardBody}><div className={styles.cardTop}><h2>{item.title??item.category.name}</h2></div><strong>{money(item.priceMinor,item.currency)}</strong><p>{meta(item)}</p><div className={styles.reputation}>{item.sellerReputation.reviewAverage!=null?<span><b>★ {item.sellerReputation.reviewAverage.toFixed(1)}</b> · {item.sellerReputation.reviewCount} avis</span>:<span>Nouveau vendeur</span>}<small>Confiance {item.sellerReputation.trust.score}/100</small></div><footer><span>📍 {item.city??"France"}</span><small>{age(item.publishedAt??item.createdAt)}</small></footer></div></a>)}</div>}
    </section></div>
  </main></div>;
}
