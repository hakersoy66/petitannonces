import "./home.css";
import type { Metadata } from "next";
import Image from "next/image";
import { AppIcon, type AppIconName } from "../components/app-icon";
import { HomeMobileCategories } from "../components/home-mobile-categories";
import { HomeFranceHero } from "../components/home-france-hero";
import { HomeFranceMobileMap } from "../components/home-france-mobile-map";
import { FavoriteButton } from "../components/favorite-button";
import { ListingCategoryPlaceholder } from "../components/listing-category-placeholder";
import { formatListingPrice } from "../lib/listing-price";
import { arrangePromotedFlow, promotionClass, promotionLabel, type ListingPromotion } from "../lib/listing-promotions";

export const metadata: Metadata = {
  title: { absolute: "Petites annonces gratuites en France : achat & vente | Petit Annonces" },
  description: "Recherchez des petites annonces gratuites en France pour acheter, vendre et publier près de chez vous : véhicules, immobilier, high-tech, maison, services et plus.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "Petites annonces gratuites en France : achat & vente | Petit Annonces",
    description: "Achetez, vendez et publiez gratuitement vos petites annonces partout en France, entre particuliers et professionnels.",
  },
};

export const revalidate = 15;



type Listing = {
  id: string; title: string | null; slug: string | null; priceMinor: number | null; currency: string; city: string | null;
  publishedAt: string | null; imageUrl: string | null; category: { name: string; slug: string; domain: string };
  vehicle?: Record<string, unknown> | null; property?: Record<string, unknown> | null;
  sellerReputation?: { verified: boolean; kind?: string; hasStore?: boolean; paymentReady?: boolean; avatarUrl?: string | null; sellerName?: string | null; reviewCount?:number; reviewAverage?:number|null; trust?: { reliableSeller?: boolean } };
  commerce?: { securePaymentEnabled:boolean; shippingEnabled:boolean };
  promotions?: ListingPromotion[];
};

type HomeHbxHotel={code:number;name:string;city:string|null;postalCode:string|null;categoryName:string|null;stars:number|null;imageUrl:string|null;description:string|null};
type HomeHbxPayload={items?:HomeHbxHotel[];destination?:{name:string}|null};

type HomeCategory = { id: string; name: string; slug: string; domain: string; children?: HomeCategory[] };
const HOME_CATEGORY_PRIORITY=["vehicules","immobilier","vacances","high-tech","mode","emploi","maison-jardin","services","enfants-bebe","animaux"] as const;
type MarketingBanner={id:string;placement:"HOME_TOP"|"HOME_AFTER_LATEST";title:string;body:string;ctaLabel:string;href:string;imageUrl:string|null;enabled:boolean;sortOrder:number};
type HomeStore={id:string;slug:string;name:string;description:string|null;logoUrl:string|null;coverUrl:string|null;city:string|null;postalCode:string|null;activeListings:number;verified:boolean};
type HomeSectionKey="hero"|"latest"|"categoryFeeds"|"trust"|"pro"|"cta";
type HomeSiteConfig = { logoUrl:string|null; heroTitleLine1:string; heroTitleLine2:string; heroLead:string; homeSections:{key:HomeSectionKey;enabled:boolean;order:number}[] };
type MobileUiPwaBlockId="search"|"categories"|"latest"|"map"|"discover"|"pro_banner"|"more"|"vacation";
type MobileUiPwaBlock={id:MobileUiPwaBlockId;enabled:boolean;order:number;title:string;subtitle:string;itemLimit:number};
type MobileUiPwaConfig={blocks:MobileUiPwaBlock[]};


async function fetchPwaUiConfig():Promise<MobileUiPwaConfig>{
  const fallback:MobileUiPwaConfig={blocks:[
    {id:"search",enabled:true,order:10,title:"Rechercher",subtitle:"",itemLimit:1},{id:"categories",enabled:true,order:20,title:"Catégories",subtitle:"",itemLimit:10},{id:"latest",enabled:true,order:30,title:"Dernières annonces",subtitle:"",itemLimit:10},{id:"map",enabled:true,order:40,title:"Explorez les annonces par ville",subtitle:"",itemLimit:10},{id:"discover",enabled:true,order:50,title:"À découvrir",subtitle:"",itemLimit:4},{id:"pro_banner",enabled:true,order:60,title:"Vous êtes professionnel ?",subtitle:"Ouvrez votre boutique gratuitement",itemLimit:1},{id:"more",enabled:true,order:70,title:"Plus d’annonces",subtitle:"",itemLimit:6},{id:"vacation",enabled:true,order:80,title:"Vacances Petit Annonces",subtitle:"Partez moins cher, profitez plus.",itemLimit:5},
  ]};
  const base=process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
  try{const r=await fetch(`${base.replace(/\/$/,"")}/mobile/ui-config?platform=PWA`,{next:{revalidate:15}});if(!r.ok)return fallback;const payload=await r.json() as{config?:Partial<MobileUiPwaConfig>};return payload.config?.blocks?{blocks:payload.config.blocks as MobileUiPwaBlock[]}:fallback}catch{return fallback}
}

async function fetchRootCategories(): Promise<HomeCategory[]> {
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/categories/tree`, { next: { revalidate: 15 } });
    if (!response.ok) return [];
    const payload = await response.json() as { categories?: HomeCategory[] };
    return payload.categories ?? [];
  } catch { return []; }
}

async function fetchPopularCities():Promise<Array<{city:string;slug:string;count:number}>>{
  const base=process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
  try{const r=await fetch(`${base.replace(/\/$/,"")}/seo/cities/popular`,{next:{revalidate:900}});if(!r.ok)return[];const p=await r.json() as{cities?:Array<{city:string;slug:string;count:number}>};return p.cities??[]}catch{return[]}
}


async function fetchHomeSiteConfig(): Promise<HomeSiteConfig> {
  const fallback:HomeSiteConfig={logoUrl:null,heroTitleLine1:"Vendez gratuitement.",heroTitleLine2:"Achetez en confiance.",heroLead:"Publiez gratuitement, achetez plus sereinement et ouvrez votre boutique Pro sans frais.",homeSections:[{key:"hero",enabled:true,order:10},{key:"latest",enabled:true,order:20},{key:"categoryFeeds",enabled:true,order:30},{key:"trust",enabled:true,order:40},{key:"pro",enabled:true,order:50},{key:"cta",enabled:true,order:60}]};
  const base=process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
  try{const response=await fetch(`${base.replace(/\/$/,"")}/public/site-config`,{next:{revalidate:15}});if(!response.ok)return fallback;const payload=await response.json() as{site?:Partial<HomeSiteConfig>};return{...fallback,...(payload.site??{})}}catch{return fallback}
}


async function fetchBanners(placement:MarketingBanner["placement"]):Promise<MarketingBanner[]>{
  const base=process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
  try{const r=await fetch(`${base.endsWith("/")?base.slice(0,-1):base}/public/banners?placement=${placement}`,{next:{revalidate:15}});if(!r.ok)return[];const p=await r.json() as{banners?:MarketingBanner[]};return p.banners??[]}catch{return[]}
}

async function fetchPublicStores():Promise<HomeStore[]>{
  const base=process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
  try{const r=await fetch(`${base.replace(/\/$/,"")}/public/stores`,{next:{revalidate:15}});if(!r.ok)return[];const p=await r.json() as{stores?:HomeStore[]};return p.stores??[]}catch{return[]}
}

const fallbackHomeHbxHotels:HomeHbxHotel[]=[
 {code:-101,name:"Hotel Duette",city:"Paris",postalCode:null,categoryName:"Hôtel partenaire",stars:null,imageUrl:null,description:null},
 {code:-102,name:"Le Senat",city:"Paris",postalCode:null,categoryName:"Hôtel partenaire",stars:null,imageUrl:null,description:null},
 {code:-103,name:"Mercure Paris Opera Garnier Hotel & Spa",city:"Paris",postalCode:null,categoryName:"Hôtel partenaire",stars:null,imageUrl:null,description:null},
 {code:-104,name:"Hotel L'Echiquier Opera Paris-Mgallery",city:"Paris",postalCode:null,categoryName:"Hôtel partenaire",stars:null,imageUrl:null,description:null},
 {code:-105,name:"Hyatt Paris Madeleine",city:"Paris",postalCode:null,categoryName:"Hôtel partenaire",stars:null,imageUrl:null,description:null},
 {code:-106,name:"Best Western Quartier Latin Pantheon",city:"Paris",postalCode:null,categoryName:"Hôtel partenaire",stars:null,imageUrl:null,description:null},
];
async function fetchHomeHbxHotels():Promise<HomeHbxHotel[]>{
  const base=process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000";
  try{const r=await fetch(`${base.replace(/\/$/,"")}/vacances/hbx/search?city=Paris&limit=6`,{next:{revalidate:1800}});if(!r.ok)return fallbackHomeHbxHotels;const p=await r.json() as HomeHbxPayload;const items=(p.items??[]).slice(0,6);return items.length?items:fallbackHomeHbxHotels}catch{return fallbackHomeHbxHotels}
}

function homeCategoryIcon(category:HomeCategory):AppIconName{
  const slug=category.slug.toLowerCase();
  if(category.domain==="VEHICLE")return "car";
  if(category.domain==="REAL_ESTATE")return "home";
  if(category.domain==="JOB")return "briefcase";
  if(category.domain==="SERVICE")return "tools";
  if(category.domain==="ANIMAL")return "paw";
  if(slug.includes("vacance")||slug.includes("hotel")||slug.includes("gite"))return "calendar";
  if(slug.includes("high")||slug.includes("tech")||slug.includes("multimedia"))return "laptop";
  if(slug.includes("maison")||slug.includes("deco"))return "couch";
  if(slug.includes("mode"))return "shirt";
  if(slug.includes("enfant")||slug.includes("bebe"))return "child";
  if(slug.includes("loisir")||slug.includes("sport"))return "football";
  return "box";
}

function MarketingBannerBlock({banner,orderValue}:{banner:MarketingBanner;orderValue:number}){return <section className="marketing-banner-zone" style={{order:orderValue}}><div className="shell home-body-shell"><a className="marketing-banner-card" href={banner.href}>{banner.imageUrl&&<Image src={banner.imageUrl} alt="" fill sizes="100vw" />}<div className="marketing-banner-copy"><span>Petit Annonces</span><h2>{banner.title}</h2>{banner.body&&<p>{banner.body}</p>}</div><strong>{banner.ctaLabel||"Découvrir"}<AppIcon name="arrow-right"/></strong></a></div></section>}

type CityFacet={city:string;count:number};
type SeoCategoryFacet={slug:string;count:number};

type ListingSearchPage={items:Listing[];total:number};
async function fetchListingPage(params = "limit=10"): Promise<ListingSearchPage> {
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/search?${params}`, { next: { revalidate: 15 } });
    if (!response.ok) return {items:[],total:0};
    const payload = await response.json() as { items?: Listing[]; total?: number };
    return {items:(payload.items ?? []).filter((item) => item.slug),total:Number(payload.total??0)};
  } catch { return {items:[],total:0}; }
}

async function fetchListings(params = "limit=10"): Promise<Listing[]> {
  return (await fetchListingPage(params)).items;
}

function shuffleListings<T>(items:T[]):T[]{
  const out=[...items];
  for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j]!,out[i]!];}
  return out;
}

async function fetchRandomListings(filterParams="",limit=50):Promise<Listing[]>{
  const prefix=filterParams.trim()?`${filterParams.replace(/^&+|&+$/g,"")}&`:"";
  const probe=await fetchListingPage(`${prefix}limit=1&sort=recent`);
  if(probe.total<=0)return[];
  const pageSize=Math.min(50,Math.max(24,limit));
  const pageCount=Math.max(1,Math.ceil(probe.total/pageSize));
  const page=1+Math.floor(Math.random()*pageCount);
  const selected=await fetchListingPage(`${prefix}limit=${pageSize}&page=${page}&sort=recent`);
  let pool=selected.items;
  if(pool.length<Math.min(limit,12)&&page!==1){const fallback=await fetchListingPage(`${prefix}limit=${pageSize}&page=1&sort=recent`);pool=[...pool,...fallback.items.filter(item=>!pool.some(existing=>existing.id===item.id))];}
  return shuffleListings(pool).slice(0,limit);
}

function listingPrice(listing: Listing) { return formatListingPrice(listing.priceMinor, listing.currency, { domain: listing.category.domain, transactionType: typeof listing.property?.transactionType === "string" ? listing.property.transactionType : null }); }

function listingMeta(listing: Listing) {
  if (listing.category.domain === "VEHICLE" && listing.vehicle) {
    const year = listing.vehicle.modelYear ?? (typeof listing.vehicle.firstRegistrationDate === "string" ? new Date(listing.vehicle.firstRegistrationDate).getFullYear() : null);
    const km = typeof listing.vehicle.mileageKm === "number" ? `${Number(listing.vehicle.mileageKm).toLocaleString("fr-FR")} km` : null;
    return [year, km].filter(Boolean).join(" · ");
  }
  if (listing.category.domain === "REAL_ESTATE" && listing.property) {
    const surface = listing.property.surfaceM2 ? `${listing.property.surfaceM2} m²` : null;
    const rooms = listing.property.rooms ? `${listing.property.rooms} pièces` : null;
    return [surface, rooms].filter(Boolean).join(" · ");
  }
  return "";
}

const trustItems = [
  { icon: "shield" as AppIconName, title: "Paiement protégé", text: "Vos transactions restent sécurisées du paiement à la réception." },
  { icon: "user-shield" as AppIconName, title: "Vendeurs vérifiés", text: "Profils, boutiques et professionnels disposent de niveaux de vérification clairs." },
  { icon: "truck" as AppIconName, title: "Livraison suivie", text: "Suivez votre colis et gardez toutes les étapes d'achat au même endroit." },
];

const HOME_SEO_FAQ=[
  {q:"Petit Annonces est-il un site de petites annonces gratuites en France ?",a:"Oui. Les particuliers peuvent déposer gratuitement une petite annonce sur Petit Annonces, sous réserve des règles de publication et de modération. Le site couvre les principales catégories partout en France."},
  {q:"Peut-on acheter et vendre entre particuliers ?",a:"Oui. Petit Annonces permet de rechercher des offres publiées par des particuliers et des professionnels, puis de contacter le vendeur depuis la plateforme."},
  {q:"Comment trouver des petites annonces près de chez moi ?",a:"Utilisez la ville, le code postal ou les pages locales pour consulter les annonces disponibles à proximité et accéder aux catégories qui possèdent réellement des offres dans la zone."},
  {q:"Comment déposer une petite annonce gratuite ?",a:"Créez votre compte, choisissez la catégorie, ajoutez un titre, des photos, un prix et votre ville, puis envoyez l’annonce pour contrôle avant publication."},
];

function ListingCard({ listing, compact = false, spotlight = null }: { listing: Listing; compact?: boolean; spotlight?:"URGENT"|"FEATURED"|null }) {
  const href = listing.slug ? `/annonce/${listing.slug}` : "/recherche";
  const meta = listingMeta(listing);
  const isPro=listing.sellerReputation?.kind==="PROFESSIONNEL"||listing.sellerReputation?.hasStore===true;
  const protectedPurchase=listing.commerce?.securePaymentEnabled===true&&listing.commerce?.shippingEnabled===true&&!(["VEHICLE","REAL_ESTATE","JOB","SERVICE"].includes(listing.category.domain));
  return <article className={`listing-card${compact ? " listing-card-compact" : ""}${spotlight?` listing-card-spotlight spotlight-${spotlight.toLowerCase()}`:""}`}>
    <div className="listing-visual listing-visual-live">
      <a className="listing-visual-link" href={href} aria-label={listing.title ?? listing.category.name}>{listing.imageUrl ? <Image src={listing.imageUrl} alt={listing.title ?? "Annonce Petit Annonces"} fill sizes="(max-width: 760px) 50vw, 25vw" /> : <ListingCategoryPlaceholder category={listing.category}/>}</a>
      <div className="home-favorite"><FavoriteButton listingId={listing.id} compact/></div>
      <div className="listing-badge-stack">{listing.promotions?.map(p=>p.type==="URGENT"?<span key={`${p.code}-${p.type}`} className="desktop-card-icon-badge urgent" data-tooltip="Urgent" aria-label="Urgent"><AppIcon name="bolt"/></span>:<span key={`${p.code}-${p.type}`} className={`promotion-badge ${promotionClass(p.type)}`}>{promotionLabel(p.type)}</span>)}{isPro&&<span className="desktop-card-icon-badge pro" data-tooltip="Professionnel" aria-label="Professionnel"><AppIcon name="store"/></span>}{protectedPurchase&&<span className="secure-badge"><AppIcon name="shield"/> Protégé</span>}</div>
    </div>
    <div className="listing-content">
      {(meta || !compact) && <div className="listing-topline">{!compact&&<span>{listing.category.name}</span>}{meta&&<span>{meta}</span>}</div>}
      <h3><a href={href}>{listing.title ?? "Annonce"}</a></h3>
      <p className="listing-city"><AppIcon name="location"/> {listing.city ?? "France"}</p>
      <div className="listing-price-row"><strong>{listingPrice(listing)}</strong><span className="listing-seller-inline"><span className="listing-seller-name">{listing.sellerReputation?.sellerName??"Membre"}{listing.sellerReputation?.reviewAverage!=null&&<small>★ {listing.sellerReputation.reviewAverage.toFixed(1)} ({listing.sellerReputation.reviewCount??0})</small>}</span>{listing.sellerReputation?.avatarUrl?<img src={listing.sellerReputation.avatarUrl} alt="Photo du vendeur" loading="lazy" decoding="async"/>:<span className="listing-seller-fallback">{(listing.sellerReputation?.sellerName??"M").slice(0,1).toUpperCase()}</span>}</span></div>
    </div>
  </article>;
}

function mobileRelativeTime(value:string|null){
  if(!value)return "";
  const diff=Math.max(0,Date.now()-new Date(value).getTime());
  const hours=Math.floor(diff/3_600_000);
  if(hours<1)return "à l’instant";
  if(hours<24)return `il y a ${hours}h`;
  const days=Math.floor(hours/24);
  if(days===1)return "hier";
  if(days<7)return `il y a ${days}j`;
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"short"}).format(new Date(value));
}

function MobileMarketplaceCard({listing}:{listing:Listing}){
  const href=listing.slug?`/annonce/${listing.slug}`:"/recherche";
  const promo=listing.promotions?.find(p=>p.type==="FEATURED")??listing.promotions?.find(p=>p.type==="SPONSORED")??listing.promotions?.find(p=>p.type==="BUMP")??listing.promotions?.find(p=>p.type==="GALLERY")??null;
  const urgent=listing.promotions?.some(p=>p.type==="URGENT")===true;
  const isPro=listing.sellerReputation?.kind==="PROFESSIONNEL"||listing.sellerReputation?.hasStore===true;
  const promoType=promo?.type?String(promo.type).toLowerCase():"";
  const shippingAvailable=listing.commerce?.shippingEnabled===true;
  const securePaymentAvailable=listing.commerce?.securePaymentEnabled===true;
  return <article className={`mobile-market-card${promoType?` mobile-market-card-${promoType}`:""}`}>
    <div className="mobile-market-card-photo">
      <a href={href} aria-label={listing.title??listing.category.name}>{listing.imageUrl?<Image src={listing.imageUrl} alt={listing.title??"Annonce Petit Annonces"} fill sizes="(max-width:720px) 50vw, 25vw" quality={68} unoptimized={listing.imageUrl.includes("/api/media/watermark/")}/>:<ListingCategoryPlaceholder category={listing.category}/>}</a>
      <div className="mobile-market-card-favorite"><FavoriteButton listingId={listing.id} compact/></div>
      {promo&&<span className={`promotion-badge ${promotionClass(promo.type)}`}>{promotionLabel(promo.type)}</span>}
      {(urgent||isPro)&&<div className="mobile-status-icon-badges">{urgent&&<span className="desktop-card-icon-badge urgent" aria-label="Urgent"><AppIcon name="bolt"/></span>}{isPro&&<span className="desktop-card-icon-badge pro" aria-label="Professionnel"><AppIcon name="store"/></span>}</div>}
      {(shippingAvailable||securePaymentAvailable)&&<div className="listing-service-icons">{shippingAvailable&&<span className="listing-service-icon is-shipping" title="Livraison possible" aria-label="Livraison possible"><AppIcon name="truck"/></span>}{securePaymentAvailable&&<span className="listing-service-icon is-payment" title="Paiement sécurisé" aria-label="Paiement sécurisé"><AppIcon name="shield"/></span>}</div>}
    </div>
    <div className="mobile-market-card-body">
      <h3><a href={href}>{listing.title??listing.category.name}</a></h3>
      <strong>{listingPrice(listing)}</strong>
      <div className="mobile-market-card-meta"><span>{listing.city??"France"}</span><small>{mobileRelativeTime(listing.publishedAt)}</small></div>
    </div>
  </article>;
}

function MarketplaceCard({listing,spotlight=null}:{listing:Listing;spotlight?:"URGENT"|"FEATURED"|null}){
  const href=listing.slug?`/annonce/${listing.slug}`:"/recherche";
  const meta=listingMeta(listing);
  const promoted=Boolean(listing.promotions?.length);
  const isPro=listing.sellerReputation?.kind==="PROFESSIONNEL"||listing.sellerReputation?.hasStore===true;
  const shippingAvailable=listing.commerce?.shippingEnabled===true;
  const securePaymentAvailable=listing.commerce?.securePaymentEnabled===true;
  return <article className={`market-home-card${promoted?" market-home-card-promoted":""}${spotlight?` market-home-card-${spotlight.toLowerCase()}`:""}`}>
    <div className="market-home-card-image">
      <a href={href} aria-label={listing.title??listing.category.name}>{listing.imageUrl?<Image src={listing.imageUrl} alt={listing.title??"Annonce Petit Annonces"} fill sizes="(max-width: 700px) 46vw, 20vw" quality={68} unoptimized={listing.imageUrl.includes("/api/media/watermark/")}/>:<ListingCategoryPlaceholder category={listing.category}/>}</a>
      <div className="market-home-favorite"><FavoriteButton listingId={listing.id} compact/></div>
      <div className="market-home-badges">{listing.promotions?.slice(0,1).map(p=>p.type==="URGENT"?<span key={`${p.code}-${p.type}`} className="desktop-card-icon-badge urgent" data-tooltip="Urgent" aria-label="Urgent"><AppIcon name="bolt"/></span>:<span key={`${p.code}-${p.type}`} className={`promotion-badge ${promotionClass(p.type)}`}>{promotionLabel(p.type)}</span>)}{isPro&&<span className="desktop-card-icon-badge pro" data-tooltip="Professionnel" aria-label="Professionnel"><AppIcon name="store"/></span>}</div>
      {(shippingAvailable||securePaymentAvailable)&&<div className="listing-service-icons">{shippingAvailable&&<span className="listing-service-icon is-shipping" title="Livraison possible" aria-label="Livraison possible"><AppIcon name="truck"/></span>}{securePaymentAvailable&&<span className="listing-service-icon is-payment" title="Paiement sécurisé" aria-label="Paiement sécurisé"><AppIcon name="shield"/></span>}</div>}
    </div>
    <div className="market-home-card-body">
      <div className="market-home-card-kicker"><span>{listing.category.name}</span>{meta&&<span>{meta}</span>}</div>
      <h3><a href={href}>{listing.title??listing.category.name}</a></h3>
      <strong>{listingPrice(listing)}</strong>
      <p><AppIcon name="location"/> {listing.city??"France"}</p>
    </div>
  </article>;
}

function HomeHbxHotelCard({hotel,mobile=false}:{hotel:HomeHbxHotel;mobile?:boolean}){
  const href=`/vacances?city=${encodeURIComponent(hotel.city??"Paris")}`;
  return <article className={`${mobile?"mobile-hbx-hotel-card":"home-hbx-hotel-card"}`}>
    <a className={`home-hbx-hotel-photo ${!hotel.imageUrl?"is-fallback":""}`} href={href}>{hotel.imageUrl?<img src={hotel.imageUrl} alt={hotel.name} loading="lazy" decoding="async"/>:<span className="home-hbx-fallback-visual"><small>PARIS</small><strong>{hotel.name}</strong><i>Hôtel partenaire HBX</i></span>}<em>HBX</em></a>
    <div className="home-hbx-hotel-body"><div className="home-hbx-hotel-meta"><span>{hotel.categoryName??"Hôtel"}</span>{hotel.stars? <b>{"★".repeat(Math.min(5,hotel.stars))}</b>:null}</div><h3><a href={href}>{hotel.name}</a></h3><p><AppIcon name="location"/> {hotel.city??"Paris"}{hotel.postalCode?` · ${hotel.postalCode}`:""}</p><a className="home-hbx-hotel-cta" href={href}>Voir les disponibilités <AppIcon name="arrow-right"/></a></div>
  </article>
}

export default async function HomePage() {
  const [recentListings, randomListings, vacationListings, roots, site, topBanners, afterLatestBanners, stores, pwaUi, popularCities, hbxHotels] = await Promise.all([fetchListings("limit=16&sort=recent"), fetchRandomListings("",50), fetchRandomListings("category=vacances",20), fetchRootCategories(), fetchHomeSiteConfig(), fetchBanners("HOME_TOP"), fetchBanners("HOME_AFTER_LATEST"), fetchPublicStores(), fetchPwaUiConfig(), fetchPopularCities(), fetchHomeHbxHotels()]);
  const homeCategoryRank=new Map<string,number>(HOME_CATEGORY_PRIORITY.map((slug,index)=>[slug,index]));
  const desktopRoots=[...roots].sort((a,b)=>(homeCategoryRank.get(a.slug)??999)-(homeCategoryRank.get(b.slug)??999)||a.name.localeCompare(b.name,"fr"));
  const mobileLatestListings=recentListings.slice(0,10);
  const latestIds=new Set(mobileLatestListings.map(item=>item.id));
  const randomPool=(randomListings.filter(item=>!latestIds.has(item.id)).length>=12?randomListings.filter(item=>!latestIds.has(item.id)):randomListings);
  const promotedRandom=shuffleListings(randomPool.filter(item=>(item.promotions?.length??0)>0));
  const regularRandom=shuffleListings(randomPool.filter(item=>(item.promotions?.length??0)===0));
  const featuredFlow=arrangePromotedFlow([...promotedRandom,...regularRandom].slice(0,12)).slice(0,5);
  const nearListings=shuffleListings(randomPool).slice(0,6);
  const latestMarketListings=recentListings.slice(0,10);
  const dealCandidates=[...randomPool].filter(item=>item.priceMinor!=null&&item.priceMinor>0&&!(["JOB","SERVICE"].includes(item.category.domain))).sort((a,b)=>(a.priceMinor??0)-(b.priceMinor??0)).slice(0,18);
  const dealListings=shuffleListings(dealCandidates).slice(0,6);
  const mobileDiscoverListings=shuffleListings(randomPool).slice(0,4);
  const mobileDiscoverIds=new Set(mobileDiscoverListings.map(item=>item.id));
  const mobileMoreListings=shuffleListings(randomPool.filter(item=>!mobileDiscoverIds.has(item.id))).slice(0,6);
  const cityShortcuts=popularCities.slice(0,8);

  const pwaBlockMap=new Map(pwaUi.blocks.map(block=>[block.id,block] as const));
  const pwaBlock=(key:MobileUiPwaBlockId)=>pwaBlockMap.get(key);
  const pwaEnabled=(key:MobileUiPwaBlockId)=>pwaBlock(key)?.enabled!==false;
  const pwaOrder=(key:MobileUiPwaBlockId)=>pwaBlock(key)?.order??999;
  const sectionMap=new Map(site.homeSections.map(section=>[section.key,section] as const));
  const enabled=(key:HomeSectionKey)=>sectionMap.get(key)?.enabled!==false;
  const order=(key:HomeSectionKey)=>sectionMap.get(key)?.order??999;
  return (
    <div id="top" className="page-shell home-page-shell">

      <main className="home-main-order">
        {pwaEnabled("categories")&&<div className="mobile-pwa-block-order" style={{order:pwaOrder("categories")}}><HomeMobileCategories categories={roots} /></div>}
        {topBanners.map((banner,index)=><MarketingBannerBlock key={banner.id} banner={banner} orderValue={5+index}/>) }
        {enabled("hero")&&<div style={{order:order("hero")}}><HomeFranceHero/></div>}


        {enabled("latest")&&<section id="annonces" className="market-home-featured desktop-market-home" style={{order:order("latest")}}><div className="shell home-body-shell">
          <div className="market-home-section-head"><div><span className="market-home-section-icon star"><AppIcon name="star"/></span><div><h2>À la une</h2><p>Les annonces mises en avant en ce moment</p></div></div><a href="/recherche">Voir toutes les annonces <AppIcon name="arrow-right"/></a></div>
          {featuredFlow.length?<div className="market-home-grid market-home-grid-five">{featuredFlow.map(({item,spotlight})=><MarketplaceCard key={item.id} listing={item} spotlight={spotlight}/>)}</div>:<div className="market-home-empty-state">Aucune annonce publiée pour le moment.</div>}
        </div></section>}
        {afterLatestBanners.map((banner,index)=><MarketingBannerBlock key={banner.id} banner={banner} orderValue={25+index}/>) }
        {enabled("categoryFeeds")&&<section className="market-home-discovery desktop-market-home" style={{order:order("categoryFeeds")}}><div className="shell home-body-shell market-home-discovery-layout">
          <div className="market-home-discovery-content">
            <section className="market-home-rail"><div className="market-home-section-head"><div><span className="market-home-section-icon recent"><AppIcon name="clock"/></span><div><h2>Dernières annonces</h2><p>Les publications les plus récentes</p></div></div><a href="/recherche?sort=recent">Voir les nouveautés <AppIcon name="arrow-right"/></a></div>{latestMarketListings.length?<div className="market-home-grid market-home-grid-five">{latestMarketListings.map(item=><MarketplaceCard key={item.id} listing={item}/>)}</div>:<div className="market-home-empty-state">Aucune nouveauté pour le moment.</div>}</section>
            <section className="market-home-rail"><div className="market-home-section-head"><div><span className="market-home-section-icon location"><AppIcon name="location"/></span><div><h2>Près de chez vous</h2><p>Choisissez une ville pour découvrir les annonces locales</p></div></div><div className="market-home-city-chips">{cityShortcuts.map(city=><a key={city.slug} href={`/ville/${city.slug}`}>{city.city}</a>)}</div></div>{nearListings.length?<div className="market-home-grid market-home-grid-six">{nearListings.map(item=><MarketplaceCard key={item.id} listing={item}/>)}</div>:<div className="market-home-empty-state">Les annonces locales apparaîtront ici.</div>}</section>
            <section className="market-home-rail"><div className="market-home-section-head"><div><span className="market-home-section-icon deal"><AppIcon name="bolt"/></span><div><h2>Bonnes affaires</h2><p>Une sélection d’annonces à prix accessibles</p></div></div><a href="/recherche?sort=price_asc">Voir les petits prix <AppIcon name="arrow-right"/></a></div>{dealListings.length?<div className="market-home-grid market-home-grid-six">{dealListings.map(item=><MarketplaceCard key={item.id} listing={item}/>)}</div>:<div className="market-home-empty-state">Les bonnes affaires arrivent bientôt.</div>}</section>
          </div>
        </div></section>}
        <div className="home-pro-vacation-stack desktop-market-home" style={{order:order("pro")}}>
        {enabled("pro")&&<section id="boutiques" className="market-home-stores"><div className="shell home-body-shell"><div className="market-home-section-head"><div><span className="market-home-section-icon store"><AppIcon name="store"/></span><div><h2>Nos boutiques professionnelles</h2><p>Découvrez les vendeurs Pro actifs sur Petit Annonces</p></div></div><a href="/professionnels">Découvrir l’espace Pro <AppIcon name="arrow-right"/></a></div>{stores.length?<div className="market-home-store-grid">{stores.slice(0,6).map(store=><a className="market-home-store-card" href={`/boutique/${store.slug}`} key={store.id}><div className="market-home-store-logo">{store.logoUrl?<img src={store.logoUrl} alt={store.name} loading="lazy" decoding="async"/>:<span>{store.name.slice(0,2).toUpperCase()}</span>}</div><div><strong>{store.name}{store.verified&&<small><AppIcon name="circle-check"/></small>}</strong><span>{store.city??"France"}</span><em>{store.activeListings} annonce{store.activeListings>1?"s":""}</em></div><AppIcon name="arrow-right"/></a>)}</div>:<div className="market-home-store-empty"><AppIcon name="store"/><div><strong>Les boutiques Pro arrivent.</strong><span>Créez votre vitrine professionnelle et soyez parmi les premières boutiques visibles ici.</span></div><a href="/inscription/pro">Créer ma boutique</a></div>}</div></section>}
        <section className="home-vacation-showcase"><div className="shell home-body-shell"><div className="home-vacation-hero"><div className="home-vacation-copy"><span><AppIcon name="calendar"/> Vacances Petit Annonces</span><h2>Partez moins cher. Profitez plus.</h2><p>Locations de vacances, appartements, chambres et hôtels disponibles directement depuis Petit Annonces.</p><div><a href="/vacances">Trouver mes vacances <AppIcon name="arrow-right"/></a><small>Disponibilités · hôtels partenaires · réservation en ligne</small></div></div><div className="home-vacation-mark"><AppIcon name="calendar"/><span>Vacances</span></div></div>{vacationListings.length?<div className="market-home-grid market-home-grid-five home-vacation-grid">{vacationListings.slice(0,5).map(item=><MarketplaceCard key={item.id} listing={item}/>)}</div>:null}{hbxHotels.length>0&&<div className="home-hbx-hotels"><div className="home-hbx-hotels-head"><div><span>Hôtels partenaires</span><h3>Des hôtels à réserver avec HBX</h3></div><a href="/vacances?city=Paris">Voir tous les hôtels <AppIcon name="arrow-right"/></a></div><div className="home-hbx-hotel-grid">{hbxHotels.map(hotel=><HomeHbxHotelCard key={hotel.code} hotel={hotel}/>)}</div></div>}{!vacationListings.length&&!hbxHotels.length&&<div className="home-vacation-empty"><AppIcon name="calendar"/><div><strong>Les premières offres de vacances arrivent.</strong><span>Publiez votre hébergement et apparaissez dans cette sélection dès sa mise en ligne.</span></div><a href="/deposer-une-annonce">Publier un hébergement</a></div>}</div></section>
        </div>
        {enabled("trust")&&<section className="market-home-trust desktop-market-home" style={{order:order("trust")}}><div className="shell home-body-shell market-home-trust-bar">{trustItems.map(item=><div key={item.title}><span><AppIcon name={item.icon}/></span><div><strong>{item.title}</strong><small>{item.text}</small></div></div>)}</div></section>}
        {pwaEnabled("latest")&&<section className="mobile-legacy-home mobile-market-section mobile-market-latest" style={{order:pwaOrder("latest")}}><div className="shell home-body-shell"><div className="mobile-market-heading"><h2>{pwaBlock("latest")?.title||"Dernières annonces"}</h2><a href="/recherche?sort=recent">Voir tout</a></div>{mobileLatestListings.length?<div className="mobile-market-grid">{mobileLatestListings.map(item=><MobileMarketplaceCard listing={item} key={item.id}/>)}</div>:<div className="live-listings-empty"><AppIcon name="list"/><div><strong>Aucune annonce publiée pour le moment.</strong></div></div>}</div></section>}
        {pwaEnabled("map")&&<div className="mobile-france-map-order" style={{order:pwaOrder("map")}}><HomeFranceMobileMap logoUrl={site.logoUrl}/></div>}
        {pwaEnabled("discover")&&mobileDiscoverListings.length>0&&<section className="mobile-legacy-home mobile-market-section mobile-market-discover" style={{order:pwaOrder("discover")}}><div className="shell home-body-shell"><div className="mobile-market-heading"><h2>{pwaBlock("discover")?.title||"À découvrir"}</h2><a href="/recherche">Voir plus</a></div><div className="mobile-market-grid">{mobileDiscoverListings.map(item=><MobileMarketplaceCard listing={item} key={item.id}/>)}</div></div></section>}
        <div className="mobile-legacy-home home-pro-vacation-stack-mobile" style={{order:pwaOrder("pro_banner")}}>
        {pwaEnabled("pro_banner")&&<section className="mobile-market-pro"><div className="shell home-body-shell"><a className="mobile-market-pro-banner" href="/inscription/pro"><span><AppIcon name="store"/></span><div><strong>{pwaBlock("pro_banner")?.title||"Vous êtes professionnel ?"}</strong><small>{pwaBlock("pro_banner")?.subtitle||"Ouvrez votre boutique gratuitement"}</small></div><AppIcon name="chevron-right"/></a></div></section>}
        </div>
        {pwaEnabled("more")&&mobileMoreListings.length>0&&<section className="mobile-legacy-home mobile-market-section mobile-market-more" style={{order:pwaOrder("more")}}><div className="shell home-body-shell"><div className="mobile-market-heading"><h2>{pwaBlock("more")?.title||"Plus d’annonces"}</h2><a href="/recherche">Voir tout</a></div><div className="mobile-market-grid">{mobileMoreListings.map(item=><MobileMarketplaceCard listing={item} key={item.id}/>)}</div></div></section>}
        <section className="mobile-legacy-home mobile-vacation-showcase" style={{order:pwaOrder("vacation")}}><div className="shell home-body-shell"><a className="mobile-vacation-banner" href="/vacances"><span><AppIcon name="calendar"/></span><div><small>{pwaBlock("vacation")?.title||"Vacances Petit Annonces"}</small><strong>{pwaBlock("vacation")?.subtitle||"Partez moins cher, profitez plus."}</strong></div><AppIcon name="chevron-right"/></a>{vacationListings.length>0&&<div className="mobile-market-grid mobile-vacation-grid">{vacationListings.slice(0,5).map(item=><MobileMarketplaceCard listing={item} key={item.id}/>)}</div>}{hbxHotels.length>0&&<div className="mobile-hbx-hotels"><div className="mobile-hbx-hotels-head"><div><small>Hôtels partenaires</small><strong>Hôtels disponibles</strong></div><a href="/vacances?city=Paris">Voir tout</a></div><div className="mobile-hbx-hotel-scroll">{hbxHotels.map(hotel=><HomeHbxHotelCard key={hotel.code} hotel={hotel} mobile/>)}</div></div>}</div></section>
        <section className="home-seo-intro" style={{order:90}} aria-labelledby="home-seo-title"><div className="shell home-body-shell"><div className="home-seo-intro-copy"><span>Petites annonces gratuites en France</span><h2 id="home-seo-title">Rechercher, acheter et vendre avec les petites annonces en France</h2><p>Petit Annonces est un site de petites annonces gratuites en France pour acheter et vendre entre particuliers ou auprès de professionnels. Publiez gratuitement une petite annonce, recherchez des offres d’occasion par catégorie ou par ville et contactez directement les vendeurs depuis la plateforme.</p></div><nav className="home-seo-links" aria-label="Catégories populaires"><a href="/deposer-annonce-gratuite">Déposer une annonce gratuite</a><a href="/categorie/vehicules">Véhicules d’occasion</a><a href="/categorie/immobilier">Immobilier</a><a href="/categorie/high-tech">High-tech</a><a href="/categorie/maison-jardin">Maison & jardin</a><a href="/categorie/collection">Objets de collection</a><a href="/categorie/services">Services</a><a href="/categorie/decoration">Décoration</a><a href="/categorie/chats">Chats</a><a href="/categorie/aspirateurs">Aspirateurs</a><a href="/vacances">Locations de vacances</a><a href="/professionnels">Déposer une annonce professionnelle</a></nav>{cityShortcuts.length>0&&<nav className="home-seo-links" aria-label="Villes populaires">{cityShortcuts.map(city=><a key={`seo-${city.slug}`} href={`/ville/${city.slug}`}>Petites annonces à {city.city}</a>)}</nav>}<div className="home-seo-faq"><div className="home-seo-faq-head"><span>Questions fréquentes</span><h3>Tout savoir sur les petites annonces gratuites</h3></div><div className="home-seo-faq-grid">{HOME_SEO_FAQ.map(item=><details key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div></div><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"FAQPage",mainEntity:HOME_SEO_FAQ.map(item=>({"@type":"Question",name:item.q,acceptedAnswer:{"@type":"Answer",text:item.a}}))}).replace(/</g,"\\u003c")}}/></div></section>

      </main>
    </div>
  );
}
