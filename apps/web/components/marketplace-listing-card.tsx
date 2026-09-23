import Image from "next/image";
import { FavoriteButton } from "./favorite-button";
import { AppIcon, type AppIconName } from "./app-icon";
import { ReputationBadges } from "./reputation-badges";
import { formatListingPrice } from "../lib/listing-price";
import { promotionClass, promotionLabel, type ListingPromotion } from "../lib/listing-promotions";
import { ListingCategoryPlaceholder } from "./listing-category-placeholder";
import { CompareToggleButton } from "./compare-toggle-button";
import styles from "./marketplace-listing-card.module.css";

type SellerReputation={
  verified?:boolean;kind?:string;hasStore?:boolean;paymentReady?:boolean;avatarUrl?:string|null;sellerName?:string|null;reviewCount?:number;reviewAverage?:number|null;trust?:{reliableSeller?:boolean};
  cardBadges?:Array<{code:string;label:string;shortLabel:string;description:string;icon:AppIconName}>;
};

type CardItem={
  id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;imageUrl:string|null;
  category:{name:string;slug:string;domain:string};
  vehicle?:{modelYear?:number|null;mileageKm?:number|null;fuel?:string|null}|Record<string,unknown>|null;
  property?:{surfaceM2?:number|null;rooms?:number|null;transactionType?:string|null}|Record<string,unknown>|null;
  promotions?:ListingPromotion[];
  sellerReputation?:SellerReputation;
  commerce?:{securePaymentEnabled?:boolean;shippingEnabled?:boolean};
};

function meta(item:CardItem){
  const vehicle=item.vehicle as {modelYear?:number|null;mileageKm?:number|null;fuel?:string|null}|null|undefined;
  if(vehicle){return [vehicle.modelYear,vehicle.mileageKm!=null?`${Number(vehicle.mileageKm).toLocaleString("fr-FR")} km`:null,vehicle.fuel].filter(Boolean).slice(0,2).join(" · ")}
  const property=item.property as {surfaceM2?:number|null;rooms?:number|null}|null|undefined;
  if(property){return [property.surfaceM2!=null?`${property.surfaceM2} m²`:null,property.rooms!=null?`${property.rooms} p.`:null].filter(Boolean).join(" · ")}
  return "";
}

export function MarketplaceListingCard({item,variant="default",showFavorite=true,imagePriority=false}:{item:CardItem;variant?:"default"|"similar";showFavorite?:boolean;imagePriority?:boolean}){
  const href=item.slug?`/annonce/${item.slug}`:"/recherche";
  const seller=item.sellerReputation;
  const sellerName=seller?.sellerName??"Membre";
  const cardMeta=meta(item);
  const isPro=seller?.kind==="PROFESSIONNEL"||seller?.hasStore===true;
  const reliable=seller?.trust?.reliableSeller===true;
  const reputationBadges=seller?.cardBadges?.slice(0,2)??[];
  const shippingAvailable=item.commerce?.shippingEnabled===true;
  const securePaymentAvailable=item.commerce?.securePaymentEnabled===true;
  const transactionType=typeof (item.property as any)?.transactionType==="string"?(item.property as any).transactionType:null;
  return <article className={`${styles.card} ${variant==="similar"?styles.similar:""}`}>
    <div className={styles.visual}>
      <a className={styles.imageLink} href={href} aria-label={item.title??item.category.name}>{item.imageUrl?<Image src={item.imageUrl} alt={item.title??item.category.name} fill sizes="(max-width:700px) 50vw, (max-width:1180px) 33vw, 260px" quality={68} priority={imagePriority} fetchPriority={imagePriority?"high":"auto"}/>:<ListingCategoryPlaceholder category={item.category}/>}</a>
      <div className={styles.badges}>{item.promotions?.slice(0,2).map(p=>p.type==="URGENT"?<b key={`${p.code}-${p.type}`} className={`${styles.desktopIconBadge} ${styles.urgentIconBadge}`} data-tooltip="Urgent" aria-label="Urgent"><AppIcon name="bolt"/></b>:<b key={`${p.code}-${p.type}`} className={`${styles.badge} ${styles[promotionClass(p.type)]??""}`}>{promotionLabel(p.type)}</b>)}{isPro&&<b className={`${styles.desktopIconBadge} ${styles.proIconBadge}`} data-tooltip="Professionnel" aria-label="Professionnel"><AppIcon name="store"/></b>}</div>
      {showFavorite&&<div className={styles.favorite}><FavoriteButton listingId={item.id} compact/></div>}
      <div className={styles.compare}><CompareToggleButton item={{id:item.id,slug:item.slug,title:item.title,imageUrl:item.imageUrl,priceMinor:item.priceMinor,currency:item.currency,city:item.city,category:item.category}}/></div>
      {(shippingAvailable||securePaymentAvailable)&&<div className={styles.serviceIcons}>{shippingAvailable&&<span className={`${styles.serviceIcon} ${styles.shippingIcon}`} title="Livraison possible" aria-label="Livraison possible"><AppIcon name="truck"/></span>}{securePaymentAvailable&&<span className={`${styles.serviceIcon} ${styles.paymentIcon}`} title="Paiement sécurisé" aria-label="Paiement sécurisé"><AppIcon name="shield"/></span>}</div>}
      {reputationBadges.length>0?<ReputationBadges badges={reputationBadges} variant="listing-card" max={2}/>:reliable&&<span className={styles.reliable}><AppIcon name="circle-check"/> Fiable</span>}
    </div>
    <div className={styles.body}>
      <div className={styles.topline}><span>{item.category.name}</span>{cardMeta&&<span>{cardMeta}</span>}</div>
      <h3><a href={href}>{item.title??item.category.name}</a></h3>
      <p className={styles.city}><AppIcon name="location"/>{item.city??"France"}</p>
      <div className={styles.footer}>
        <strong>{formatListingPrice(item.priceMinor,item.currency,{domain:item.category.domain,transactionType})}</strong>
        {seller&&<span className={styles.seller}>{seller?.avatarUrl?<img src={seller.avatarUrl} alt={`Photo de ${sellerName}`} loading="lazy" decoding="async"/>:<span className={styles.sellerFallback}>{sellerName.slice(0,1).toUpperCase()}</span>}<span className={styles.sellerCopy}><b>{sellerName}</b>{seller.reviewAverage!=null&&<small>★ {seller.reviewAverage.toFixed(1)} ({seller.reviewCount??0})</small>}</span></span>}
      </div>
    </div>
  </article>;
}
