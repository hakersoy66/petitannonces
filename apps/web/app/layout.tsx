import type { Metadata, Viewport } from "next";
import { Suspense, type CSSProperties } from "react";
import { preload } from "react-dom";
import { CookieConsent } from "../components/cookie-consent";
import { GoogleAnalytics } from "../components/google-analytics";
import { GoogleAdsConversions } from "../components/google-ads-conversions";
import { MaintenanceScreen } from "../components/maintenance-screen";
import { NavigationRecovery } from "../components/navigation-recovery";
import { NavigationExperience } from "../components/navigation-experience";
import { OAuthSignupTracker } from "../components/oauth-signup-tracker";
import { PwaClient } from "../components/pwa-client";
import { RegistrationAttributionCapture } from "../components/registration-attribution";
import { SecurityHoldGuard } from "../components/security-hold-guard";
import { SiteFooter, type FooterGroup } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { SiteTelemetry } from "../components/site-telemetry";
import { WebVitalsReporter } from "../components/web-vitals-reporter";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
import "./maintenance.css";
import "./pwa.css";

type SiteConfig={
 siteName:string;tagline:string;logoUrl:string|null;footerLogoUrl:string|null;footerDescription?:string;footerGroups?:FooterGroup[];appLogoUrl:string|null;mobileLogoUrl:string|null;
 pwaIconUrl:string|null;pwaIcon180Url:string|null;pwaIcon192Url:string|null;pwaIcon512Url:string|null;faviconUrl:string|null;
 ogImageUrl:string|null;accentColor:string;seoTitle:string;seoDescription:string;navigationCategorySlugs?:string[];watermarkEnabled:boolean;watermarkReinforced:boolean;watermarkOpacity:number;
};
type HeaderCategory={id:string;name:string;slug:string;domain:string;children?:HeaderCategory[]};

const fallbackSite:SiteConfig={siteName:"Petit Annonces",tagline:"Achetez et vendez partout en France",logoUrl:null,footerLogoUrl:null,appLogoUrl:null,mobileLogoUrl:null,pwaIconUrl:null,pwaIcon180Url:null,pwaIcon192Url:null,pwaIcon512Url:null,faviconUrl:null,ogImageUrl:null,accentColor:"#5b4cf0",watermarkEnabled:true,watermarkReinforced:true,watermarkOpacity:.88,seoTitle:"Petit Annonces FR – Petites annonces gratuites en France",seoDescription:"Achetez et vendez partout en France sur Petit Annonces. Publiez gratuitement vos annonces de véhicules, immobilier, high-tech, maison, emploi et services."};

function apiUrls(path:string){
 const internal=process.env.API_INTERNAL_URL?.replace(/\/$/,"");
 return [internal?`${internal}${path}`:null,`https://petitannonces.fr/api${path}`].filter((value):value is string=>Boolean(value));
}

async function siteConfig():Promise<SiteConfig>{
 for(const url of apiUrls("/public/site-config")){
  try{const r=await fetch(url,{next:{revalidate:15},signal:AbortSignal.timeout(1500)});if(!r.ok)continue;const p=await r.json() as{site:SiteConfig};if(p?.site)return{...fallbackSite,...p.site}}catch{}
 }
 return fallbackSite;
}

async function headerCategories():Promise<HeaderCategory[]>{
 for(const url of apiUrls("/categories/tree")){
  try{const r=await fetch(url,{next:{revalidate:60},signal:AbortSignal.timeout(1500)});if(!r.ok)continue;const p=await r.json() as{categories?:HeaderCategory[]};if(Array.isArray(p?.categories))return p.categories}catch{}
 }
 return [];
}

async function maintenanceStatus():Promise<boolean>{
 for(const url of apiUrls("/public/maintenance-status")){
  try{const r=await fetch(url,{next:{revalidate:2},signal:AbortSignal.timeout(1200)});if(!r.ok)continue;const p=await r.json() as{maintenanceMode?:boolean};return p.maintenanceMode===true}catch{}
 }
 return false;
}

export async function generateMetadata():Promise<Metadata>{
 const[site,maintenance]=await Promise.all([siteConfig(),maintenanceStatus()]);
 const favicon=site.faviconUrl??"/icons/icon-192.png";
 const faviconVersion=(site.faviconUrl??favicon).split("/").pop()??"default";
 const faviconHref=`${favicon}${favicon.includes("?")?"&":"?"}v=${encodeURIComponent(faviconVersion)}`;
 const pwaRaster=site.pwaIconUrl&&!site.pwaIconUrl.split("?")[0]?.toLowerCase().endsWith(".svg")?site.pwaIconUrl:null;
 const faviconRaster=site.faviconUrl&&!site.faviconUrl.split("?")[0]?.toLowerCase().endsWith(".svg")?site.faviconUrl:null;
 const appleIcon=site.pwaIcon180Url??pwaRaster??faviconRaster??"/icons/icon-180.png";
 const manifestVersion=(site.pwaIcon512Url??site.pwaIconUrl??"default").split("/").pop()??"default";
 return{metadataBase:new URL("https://petitannonces.fr"),title:{default:site.seoTitle,template:`%s | ${site.siteName}`},description:site.seoDescription,applicationName:site.siteName,manifest:`/manifest.webmanifest?v=${encodeURIComponent(manifestVersion)}`,icons:{icon:faviconHref,shortcut:faviconHref,apple:appleIcon},appleWebApp:{capable:true,title:site.siteName,statusBarStyle:"default"},robots:maintenance?{index:false,follow:false}:undefined,openGraph:{type:"website",locale:"fr_FR",siteName:site.siteName,title:site.seoTitle,description:site.seoDescription,images:site.ogImageUrl?[site.ogImageUrl]:undefined}};
}

export async function generateViewport():Promise<Viewport>{const site=await siteConfig();return{themeColor:"#ffffff",width:"device-width",initialScale:1,viewportFit:"auto",interactiveWidget:"resizes-content"}}

export default async function RootLayout({children}:{children:React.ReactNode}){
 const[site,maintenance,categories]=await Promise.all([siteConfig(),maintenanceStatus(),headerCategories()]);
 if(maintenance){
  return <html lang="fr"><body><MaintenanceScreen site={{siteName:site.siteName,logoUrl:site.logoUrl,accentColor:site.accentColor}}/></body></html>;
 }
 const splashLogo=site.footerLogoUrl??site.logoUrl??site.appLogoUrl??"/pwa-loading-logo.svg";
 preload(splashLogo,{as:"image",media:"(display-mode: standalone)"});
 const organizationJsonLd={"@context":"https://schema.org","@type":"Organization",name:site.siteName,alternateName:["PetitAnnonces.fr","Petit Annonces FR"],url:"https://petitannonces.fr",logo:site.logoUrl??"https://petitannonces.fr/icons/icon-512.png",hasShippingService:{"@type":"ShippingService","@id":"https://petitannonces.fr/#shipping-france",name:"Livraison en France via les transporteurs disponibles",description:"Les frais et délais de livraison sont calculés au moment de la commande selon le transporteur disponible, le colis et la destination.",fulfillmentType:"https://schema.org/FulfillmentTypeDelivery",shippingConditions:{"@type":"ShippingConditions",shippingDestination:{"@type":"DefinedRegion",addressCountry:"FR"}}}};
 const websiteJsonLd={"@context":"https://schema.org","@type":"WebSite",name:site.siteName,alternateName:["PetitAnnonces.fr","Petit Annonces FR"],url:"https://petitannonces.fr",inLanguage:"fr-FR",potentialAction:{"@type":"SearchAction",target:"https://petitannonces.fr/recherche?q={search_term_string}","query-input":"required name=search_term_string"}};
 return <html lang="fr"><head><meta name="googlebot" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1"/><link rel="preconnect" href="https://media.petitannonces.fr" crossOrigin="anonymous"/><link rel="dns-prefetch" href="//media.petitannonces.fr"/><link rel="preconnect" href="https://www.googletagmanager.com"/><link rel="dns-prefetch" href="//www.googletagmanager.com"/><link rel="preconnect" href="https://www.google-analytics.com"/><link rel="dns-prefetch" href="//www.google-analytics.com"/><link rel="apple-touch-startup-image" href="/ios-splash/splash-1179x2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"/><link rel="apple-touch-startup-image" href="/ios-splash/splash-1206x2622.png" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)"/><link rel="apple-touch-startup-image" href="/ios-splash/splash-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"/><link rel="apple-touch-startup-image" href="/ios-splash/splash-1320x2868.png" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)"/><link rel="apple-touch-startup-image" href="/ios-splash/splash-1242x2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)"/><link rel="apple-touch-startup-image" href="/ios-splash/splash-1284x2778.png" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"/><script dangerouslySetInnerHTML={{__html:`try{var s=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(s&&localStorage.getItem("pa_pwa_onboarding_complete_v1")==="1")document.documentElement.classList.add("pa-pwa-launch-splash-active")}catch(e){}`}}/></head><body data-pa-watermark-enabled={site.watermarkEnabled?"true":"false"} data-pa-watermark-reinforced={site.watermarkReinforced?"true":"false"} style={{"--pa-watermark-opacity":site.watermarkOpacity} as CSSProperties}><div className="pwa-launch-splash" role="status" aria-live="polite" aria-label="Chargement de Petit Annonces" data-no-pull-refresh><div className="pwa-launch-splash-center"><img src={splashLogo} alt={site.siteName} className="pwa-launch-splash-logo"/><div className="pwa-launch-splash-loader" aria-hidden="true"><i/><i/><i/></div><span>Chargement des annonces…</span></div></div><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(organizationJsonLd)}}/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(websiteJsonLd)}}/><RegistrationAttributionCapture/><OAuthSignupTracker/><SecurityHoldGuard/><NavigationRecovery/><SiteHeader initialBrand={site} initialCategories={categories}/>{children}<SiteFooter initialConfig={{siteName:site.siteName,logoUrl:site.logoUrl,footerLogoUrl:site.footerLogoUrl,footerDescription:site.footerDescription,footerGroups:site.footerGroups}}/><CookieConsent/><Suspense fallback={null}><GoogleAnalytics measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID??"G-H1WZ5519J1"}/></Suspense><GoogleAdsConversions/><NavigationExperience/><PwaClient initialPwaIconUrl={site.pwaIcon512Url??site.pwaIcon192Url??site.pwaIconUrl??site.mobileLogoUrl??"/icons/icon-192.png"} initialAppLogoUrl={site.appLogoUrl??site.logoUrl??site.pwaIcon512Url??site.pwaIcon192Url??site.pwaIconUrl??"/icons/icon-192.png"}/><SiteTelemetry/><WebVitalsReporter/></body></html>;
}