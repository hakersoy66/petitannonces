import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {AppIcon} from "../../../../components/app-icon";
import {cityNameFromStores,getPublicStores,PRO_DEFAULT_COVER,PRO_DEFAULT_LOGO,SITE_BASE,proSlug,safeProJsonLd,storeMatchesCity} from "../../../../lib/professional-directory";
import styles from "../../page.module.css";

export const revalidate=120;
type Props={params:Promise<{city:string}>};

export async function generateMetadata({params}:Props):Promise<Metadata>{
 const{city}=await params;const stores=await getPublicStores();const cityName=cityNameFromStores(stores,city);const matched=stores.filter(s=>storeMatchesCity(s,city));
 if(!cityName||!matched.length)return{title:{absolute:"Professionnels par ville | Petit Annonces"},robots:{index:false,follow:true}};
 const canonical=`/professionnels/ville/${city}`;const title=`Professionnels à ${cityName} : boutiques et vendeurs Pro | Petit Annonces`;const description=`Découvrez ${matched.length} professionnel${matched.length>1?"s":""} et boutique${matched.length>1?"s":""} à ${cityName} sur Petit Annonces, classés par secteur avec annonces actives et informations de vérification.`;
 return{title:{absolute:title},description,alternates:{canonical},robots:{index:true,follow:true},openGraph:{type:"website",url:canonical,title,description}};
}

export default async function CityHub({params}:Props){
 const{city}=await params;const stores=await getPublicStores();const cityName=cityNameFromStores(stores,city);const matched=stores.filter(s=>storeMatchesCity(s,city));if(!cityName||!matched.length)notFound();
 const sectors=[...new Map(matched.flatMap(s=>s.sectors??[]).map(item=>[item.slug,item.name] as const)).entries()].sort((a,b)=>a[1].localeCompare(b[1],"fr"));
 const canonical=`${SITE_BASE}/professionnels/ville/${city}`;
 const breadcrumb={"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",position:1,name:"Accueil",item:`${SITE_BASE}/`},{"@type":"ListItem",position:2,name:"Professionnels",item:`${SITE_BASE}/professionnels`},{"@type":"ListItem",position:3,name:cityName,item:canonical}]};
 const itemList={"@context":"https://schema.org","@type":"ItemList",name:`Professionnels à ${cityName}`,url:canonical,numberOfItems:matched.length,itemListElement:matched.map((s,i)=>({"@type":"ListItem",position:i+1,url:`${SITE_BASE}/boutique/${s.slug}`,name:s.name}))};
 return <div className={styles.page}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeProJsonLd(breadcrumb)}}/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeProJsonLd(itemList)}}/><main><section className={styles.directory} style={{paddingTop:42}}><div className={styles.shell}>
  <nav aria-label="Fil d’Ariane" style={{fontSize:12,color:"#747584",marginBottom:18}}><a href="/" style={{color:"#5b4cf0"}}>Accueil</a> › <a href="/professionnels" style={{color:"#5b4cf0"}}>Professionnels</a> › {cityName}</nav>
  <header style={{padding:"31px 32px",borderRadius:28,background:"linear-gradient(135deg,#4f43d4,#7569f6)",color:"white",boxShadow:"0 22px 58px rgba(67,55,160,.18)"}}><span style={{fontSize:11,fontWeight:900,letterSpacing:1,textTransform:"uppercase",opacity:.86}}>Annuaire professionnel local</span><h1 style={{margin:"8px 0 9px",fontSize:"clamp(30px,5vw,52px)",lineHeight:1.02,letterSpacing:"-.05em"}}>Professionnels à {cityName}</h1><p style={{margin:0,maxWidth:850,lineHeight:1.65,opacity:.92}}>Découvrez les boutiques et vendeurs professionnels actifs à {cityName}. Choisissez un secteur pour accéder directement aux professionnels et aux annonces correspondantes.</p></header>
  <section style={{marginTop:24,padding:20,border:"1px solid #e7e5ef",borderRadius:20,background:"#fff"}}><small style={{color:"#858692",fontWeight:850}}>EXPLORER PAR SECTEUR</small><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>{sectors.map(([slug,name])=><a key={slug} href={`/professionnels/${slug}/${city}`} style={{padding:"9px 12px",border:"1px solid #e2e1ea",borderRadius:999,textDecoration:"none",color:"#5145cc",fontSize:11,fontWeight:850}}>{name}</a>)}</div></section>
  <div className={styles.storeGrid}>{matched.map(store=><article className={styles.storeCard} key={store.id}><a className={styles.storeCover} href={`/boutique/${store.slug}`}><img src={store.coverUrl||PRO_DEFAULT_COVER} alt=""/>{store.verified&&<span className={styles.verifiedBadge}><AppIcon name="circle-check"/> Vérifié</span>}</a><div className={styles.storeBody}><a className={styles.storeLogo} href={`/boutique/${store.slug}`}><img src={store.logoUrl||PRO_DEFAULT_LOGO} alt={`Logo ${store.name}`}/></a><div className={styles.storeTitleRow}><div><h3><a href={`/boutique/${store.slug}`}>{store.name}</a></h3><p>{[store.postalCode,store.city].filter(Boolean).join(" ")}</p></div><strong>{store.activeListings}<span> annonces</span></strong></div><div className={styles.storeTags}>{store.primarySector&&<a href={`/professionnels/${store.primarySector.slug}/${city}`}>{store.primarySector.name}</a>}{store.siretVerified&&<span className={styles.siretTag}>SIRET vérifié</span>}</div>{store.description&&<p className={styles.storeDescription}>{store.description}</p>}<div className={styles.storeFooter}><span>{store.sectors?.length>1?`${store.sectors.length} secteurs`:store.primarySector?.name??"Professionnel"}</span><a href={`/boutique/${store.slug}`}>Voir la boutique <AppIcon name="arrow-right"/></a></div></div></article>)}</div>
  <div className={styles.directoryCta}><div><span>Votre entreprise est à {cityName} ?</span><h3>Rejoignez l’annuaire professionnel local.</h3><p>Créez votre boutique Pro et publiez vos annonces pour apparaître automatiquement dans les pages de votre ville et de vos secteurs.</p></div><a href="/inscription/pro">Créer ma boutique Pro <AppIcon name="arrow-right"/></a></div>
 </div></section></main></div>;
}
