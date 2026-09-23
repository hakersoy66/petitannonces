"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppIcon, type AppIconName } from "./app-icon";
import { lockBodyScroll } from "../lib/body-scroll-lock";
import { navigateApp } from "../lib/app-navigation";

type Category={id:string;name:string;slug:string;domain:string;children?:Category[]};
type HeaderSummary={unreadConversations:number;pendingOffers:number;unreadNotifications:number};
type SearchSuggestion={type:"listing";label:string;value:string;id?:string;imageUrl?:string|null;priceMinor?:number|null;currency?:string|null;city?:string|null};
type PublicSiteConfig={siteName:string;tagline:string;logoUrl:string|null;mobileLogoUrl:string|null;accentColor:string;navigationCategorySlugs?:string[]};
function apiBase(){return (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");}
function formatSuggestionPrice(priceMinor?:number|null,currency?:string|null){if(priceMinor==null||!Number.isFinite(priceMinor))return null;try{return new Intl.NumberFormat("fr-FR",{style:"currency",currency:currency||"EUR",maximumFractionDigits:0}).format(priceMinor/100)}catch{return `${Math.round(priceMinor/100)} €`}}

function categoryIcon(category:Category):AppIconName{
 const slug=category.slug.toLowerCase();
 if(category.domain==="VEHICLE"||slug.includes("vehicule")||slug.includes("voiture"))return "car";
 if(category.domain==="REAL_ESTATE"||slug.includes("immobilier"))return "home";
 if(category.domain==="JOB"||slug.includes("emploi"))return "briefcase";
 if(category.domain==="SERVICE"||slug.includes("service"))return "tools";
 if(category.domain==="ANIMAL"||slug.includes("anim"))return "paw";
 if(slug.includes("vacance")||slug.includes("hotel")||slug.includes("gite"))return "calendar";
 if(slug.includes("high")||slug.includes("informat")||slug.includes("teleph"))return "laptop";
 if(slug.includes("maison")||slug.includes("jardin"))return "couch";
 if(slug.includes("mode"))return "shirt";
 if(slug.includes("sport"))return "football";
 if(slug.includes("enfant"))return "child";
 return "list";
}

function categoryAdvice(category:Category){
 const slug=category.slug.toLowerCase();
 if(category.domain==="VEHICLE"||slug.includes("vehicule"))return{
  safety:"Vérifiez l’identité du vendeur, les documents du véhicule et la cohérence de l’immatriculation avant tout paiement.",
  tip:"Demandez l’historique d’entretien, contrôlez le kilométrage et privilégiez un essai avant de conclure."
 };
 if(category.domain==="REAL_ESTATE"||slug.includes("immobilier"))return{
  safety:"Visitez le bien, vérifiez l’identité du propriétaire ou de l’agence et ne versez jamais d’acompte avant les contrôles nécessaires.",
  tip:"Comparez le DPE, les charges, la surface et la localisation avant de prendre votre décision."
 };
 if(slug.includes("vacance"))return{
  safety:"Vérifiez l’identité de l’hôte, l’adresse de l’hébergement et les conditions d’annulation avant de confirmer votre séjour.",
  tip:"Comparez les dates disponibles, la capacité, les équipements et le tarif par nuit avant de contacter l’hôte."
 };
 if(slug.includes("high")||slug.includes("informat")||slug.includes("teleph"))return{
  safety:"Contrôlez le numéro de série ou l’IMEI et évitez les paiements hors plateforme pour un appareil que vous n’avez pas vérifié.",
  tip:"Testez l’écran, la batterie, les ports, les caméras et demandez la facture quand elle est disponible."
 };
 if(slug.includes("mode"))return{
  safety:"Méfiez-vous des contrefaçons et demandez des photos détaillées des étiquettes, coutures et références pour les articles de marque.",
  tip:"Vérifiez les mesures, l’état réel, la matière et les éventuels défauts avant l’achat."
 };
 if(category.domain==="ANIMAL"||slug.includes("anim"))return{
  safety:"Vérifiez l’identité du cédant, les documents obligatoires et les conditions de vie de l’animal avant toute transaction.",
  tip:"Posez des questions sur l’âge, la santé, l’identification, les vaccins et les habitudes de l’animal."
 };
 if(category.domain==="JOB"||slug.includes("emploi"))return{
  safety:"Ne payez jamais pour obtenir un emploi et ne transmettez pas de documents sensibles avant d’avoir vérifié l’employeur.",
  tip:"Contrôlez l’entreprise, le type de contrat, la rémunération, le lieu et les horaires proposés."
 };
 if(category.domain==="SERVICE"||slug.includes("service"))return{
  safety:"Demandez l’identité et les références du prestataire et clarifiez le prix avant le début de la prestation.",
  tip:"Définissez précisément le périmètre, le délai, le matériel inclus et les conditions d’annulation."
 };
 if(slug.includes("maison")||slug.includes("jardin"))return{
  safety:"Pour les objets volumineux, vérifiez l’état sur place et organisez une remise dans un lieu adapté et sûr.",
  tip:"Demandez les dimensions exactes, l’état, les accessoires inclus et les conditions de transport."
 };
 if(slug.includes("enfant"))return{
  safety:"Pour les équipements bébé, vérifiez les rappels produits, l’état des fixations et l’absence de pièces endommagées.",
  tip:"Contrôlez l’âge recommandé, les dimensions et la compatibilité avant l’achat."
 };
 return{
  safety:"Conservez vos échanges sur Petit Annonces et restez vigilant face aux demandes urgentes ou aux paiements inhabituels.",
  tip:"Comparez plusieurs annonces, demandez des photos supplémentaires et vérifiez les détails avant de vous engager."
 };
}

const CATEGORY_PRIORITY=["vehicules","immobilier","vacances","high-tech","mode","emploi","maison-jardin","services","enfants-bebe","animaux"] as const;
const DEFAULT_BRAND:PublicSiteConfig={siteName:"Petit Annonces",tagline:"",logoUrl:null,mobileLogoUrl:null,accentColor:"#5b4cf0",navigationCategorySlugs:[...CATEGORY_PRIORITY]};
type HeaderAccountCache={authenticated:boolean;kind:"PARTICULIER"|"PROFESSIONNEL"|null;avatarUrl:string|null;name:string};
let headerBrandCache:PublicSiteConfig|null=null;
let headerAccountCache:HeaderAccountCache|null=null;
let headerSummaryCache:HeaderSummary|null=null;
let headerCategoriesCache:Category[]|null=null;
function sortCategories(categories:Category[],priority:readonly string[]=CATEGORY_PRIORITY){
 const rank=new Map<string,number>(priority.map((slug,index)=>[slug,index]));
 return [...categories].sort((a,b)=>{
  const ar=rank.has(a.slug)?rank.get(a.slug)!:999; const br=rank.has(b.slug)?rank.get(b.slug)!:999;
  if(ar!==br)return ar-br; return a.name.localeCompare(b.name,"fr");
 });
}

export function SiteHeader({initialBrand,initialCategories}:{initialBrand?:PublicSiteConfig;initialCategories?:Category[]}={}){
 const router=useRouter();
 const pathname=usePathname();
 const [authenticated,setAuthenticated]=useState(headerAccountCache?.authenticated??false);
 const [accountKind,setAccountKind]=useState<"PARTICULIER"|"PROFESSIONNEL"|null>(headerAccountCache?.kind??null);
 const [accountAvatarUrl,setAccountAvatarUrl]=useState<string|null>(headerAccountCache?.avatarUrl??null);
 const [accountName,setAccountName]=useState(headerAccountCache?.name??"Mon compte");
 const [brand,setBrand]=useState<PublicSiteConfig>(initialBrand??headerBrandCache??DEFAULT_BRAND);
 const [brandResolved,setBrandResolved]=useState(Boolean(initialBrand??headerBrandCache));
 const [summary,setSummary]=useState<HeaderSummary>(headerSummaryCache??{unreadConversations:0,pendingOffers:0,unreadNotifications:0});
 const [categories,setCategories]=useState<Category[]>(initialCategories??headerCategoriesCache??[]);
 const [activeCategoryId,setActiveCategoryId]=useState<string|null>(null);
 const [searchQuery,setSearchQuery]=useState("");
 const [searching,setSearching]=useState(false);
 const [searchSuggestions,setSearchSuggestions]=useState<SearchSuggestion[]>([]);
 const [searchSuggestionsOpen,setSearchSuggestionsOpen]=useState(false);
 const [searchSuggestionsLoading,setSearchSuggestionsLoading]=useState(false);
 const [mobileAccountOpen,setMobileAccountOpen]=useState(false);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const openTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const suggestionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const searchFormRef=useRef<HTMLFormElement|null>(null);
 useEffect(()=>{
  if(initialBrand){headerBrandCache=initialBrand;setBrandResolved(true);if(initialBrand.accentColor)document.documentElement.style.setProperty("--primary",initialBrand.accentColor);return;}
  let mounted=true;
  fetch(`${apiBase()}/public/site-config`).then(async r=>{if(r.ok&&mounted){const p=await r.json() as {site:PublicSiteConfig};headerBrandCache=p.site;setBrand(p.site);setBrandResolved(true);if(p.site.accentColor)document.documentElement.style.setProperty("--primary",p.site.accentColor)}else if(mounted)setBrandResolved(true)}).catch(()=>{if(mounted)setBrandResolved(true)});
  return()=>{mounted=false};
 },[initialBrand]);
 useEffect(()=>{
  function onKey(event:KeyboardEvent){if(event.key==="Escape"){setMobileAccountOpen(false);setSearchSuggestionsOpen(false)}}
  function onMobileAccountToggle(){setMobileAccountOpen(v=>!v)}
  function onPointerDown(event:PointerEvent){if(searchFormRef.current&&!searchFormRef.current.contains(event.target as Node))setSearchSuggestionsOpen(false)}
  window.addEventListener("keydown",onKey);
  window.addEventListener("pointerdown",onPointerDown);
  window.addEventListener("pa:toggle-mobile-account",onMobileAccountToggle);
  return()=>{window.removeEventListener("keydown",onKey);window.removeEventListener("pointerdown",onPointerDown);window.removeEventListener("pa:toggle-mobile-account",onMobileAccountToggle)};
 },[]);
 useEffect(()=>{
  if(!mobileAccountOpen)return;
  const unlock=lockBodyScroll();
  return()=>unlock();
 },[mobileAccountOpen]);
 useEffect(()=>{setMobileAccountOpen(false)},[pathname]);
 useEffect(()=>{
  const query=searchQuery.trim();
  if(suggestionTimer.current)clearTimeout(suggestionTimer.current);
  if(query.length<2){setSearchSuggestions([]);setSearchSuggestionsOpen(false);setSearchSuggestionsLoading(false);return;}
  let cancelled=false;
  setSearchSuggestionsLoading(true);
  suggestionTimer.current=setTimeout(async()=>{
   try{
    const response=await fetch(`${apiBase()}/search/autocomplete?q=${encodeURIComponent(query)}`,{cache:"no-store"});
    const payload=response.ok?await response.json() as {suggestions?:SearchSuggestion[]}:null;
    if(cancelled)return;
    const listings=(payload?.suggestions??[]).filter((item):item is SearchSuggestion=>item.type==="listing").slice(0,6);
    setSearchSuggestions(listings);setSearchSuggestionsOpen(true);
   }catch{if(!cancelled){setSearchSuggestions([]);setSearchSuggestionsOpen(true)}}finally{if(!cancelled)setSearchSuggestionsLoading(false)}
  },250);
  return()=>{cancelled=true;if(suggestionTimer.current)clearTimeout(suggestionTimer.current)};
 },[searchQuery]);
 useEffect(()=>{const sync=(event:Event)=>{const count=Number((event as CustomEvent<number>).detail);if(Number.isFinite(count))setSummary(v=>{const next={...v,unreadNotifications:Math.max(0,count)};headerSummaryCache=next;return next})};window.addEventListener("pa:notification-count",sync);return()=>window.removeEventListener("pa:notification-count",sync)},[]);
 useEffect(()=>{const sync=(event:Event)=>{const detail=(event as CustomEvent<Partial<HeaderSummary>>).detail;if(!detail||typeof detail!=="object")return;setSummary(v=>{const next={...v,...detail,unreadConversations:Math.max(0,Number(detail.unreadConversations??v.unreadConversations)),pendingOffers:Math.max(0,Number(detail.pendingOffers??v.pendingOffers)),unreadNotifications:Math.max(0,Number(detail.unreadNotifications??v.unreadNotifications))};headerSummaryCache=next;return next})};window.addEventListener("pa:message-summary",sync);return()=>window.removeEventListener("pa:message-summary",sync)},[]);
 useEffect(()=>{
  let active=true;
  if(initialCategories?.length)headerCategoriesCache=initialCategories;
  const categoriesRequest=initialCategories?.length?Promise.resolve<Response|null>(null):fetch(`${apiBase()}/categories/tree`);
  Promise.allSettled([
   fetch(`${apiBase()}/auth/me`,{credentials:"include"}),
   categoriesRequest,
  ]).then(async results=>{
   if(!active)return;
   const me=results[0],cats=results[1];
   if(me.status==="fulfilled"&&me.value.ok){
    const payload=await me.value.json() as {user?:{kind?:"PARTICULIER"|"PROFESSIONNEL";email?:string;profile?:{avatarUrl?:string|null;displayName?:string|null}}};
    const nextAccount:HeaderAccountCache={authenticated:true,kind:payload.user?.kind??null,avatarUrl:payload.user?.profile?.avatarUrl??null,name:payload.user?.profile?.displayName?.trim()||payload.user?.email?.split("@")[0]||"Mon compte"};
    headerAccountCache=nextAccount;setAuthenticated(true);setAccountKind(nextAccount.kind);setAccountAvatarUrl(nextAccount.avatarUrl);setAccountName(nextAccount.name);
    const sum=await fetch(`${apiBase()}/account/message-summary`,{credentials:"include"}).catch(()=>null);
    if(active&&sum?.ok){const nextSummary=await sum.json() as HeaderSummary;headerSummaryCache=nextSummary;setSummary(nextSummary)}
   }else if(me.status==="fulfilled"&&me.value.status===401){
    headerAccountCache={authenticated:false,kind:null,avatarUrl:null,name:"Mon compte"};setAuthenticated(false);setAccountKind(null);setAccountAvatarUrl(null);setAccountName("Mon compte");
   }
   if(cats.status==="fulfilled"&&cats.value?.ok){const payload=await cats.value.json() as {categories:Category[]};headerCategoriesCache=payload.categories??[];setCategories(headerCategoriesCache)}
  }).catch(()=>{});
  return()=>{active=false;if(closeTimer.current)clearTimeout(closeTimer.current);if(openTimer.current)clearTimeout(openTimer.current)};
 },[]);
 function openCategory(id:string){if(closeTimer.current)clearTimeout(closeTimer.current);if(openTimer.current)clearTimeout(openTimer.current);setActiveCategoryId(id)}
 function scheduleCategoryOpen(id:string){if(closeTimer.current)clearTimeout(closeTimer.current);if(openTimer.current)clearTimeout(openTimer.current);openTimer.current=setTimeout(()=>setActiveCategoryId(id),500)}
 function delayedClose(){if(openTimer.current)clearTimeout(openTimer.current);closeTimer.current=setTimeout(()=>setActiveCategoryId(null),180)}
 async function submitAiSearch(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setSearchSuggestionsOpen(false);const query=searchQuery.trim();if(!query){navigateApp(router,"/recherche");return}setSearching(true);
  try{const response=await fetch(`${apiBase()}/search/ai`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query})});if(!response.ok)throw new Error();const payload=await response.json() as {params?:Record<string,string|number>};const params=new URLSearchParams();for(const[key,value]of Object.entries(payload.params??{}))params.set(key,String(value));if(!params.size)params.set("q",query);navigateApp(router,`/recherche?${params.toString()}`);}catch{navigateApp(router,`/recherche?q=${encodeURIComponent(query)}`);}finally{setSearching(false)}
 }
 async function logout(){try{await fetch(`${apiBase()}/auth/logout`,{method:"POST",credentials:"include"})}finally{headerAccountCache={authenticated:false,kind:null,avatarUrl:null,name:"Mon compte"};headerSummaryCache={unreadConversations:0,pendingOffers:0,unreadNotifications:0};setAuthenticated(false);setAccountKind(null);setAccountAvatarUrl(null);setAccountName("Mon compte");navigateApp(router,"/",{replace:true})}}
 const navigationPriority=(brand.navigationCategorySlugs?.length?brand.navigationCategorySlugs:[...CATEGORY_PRIORITY]);
 const orderedCategories=sortCategories(categories,navigationPriority);
 const prioritySet=new Set<string>(navigationPriority);
 const visibleCategories=navigationPriority.map(slug=>orderedCategories.find(category=>category.slug===slug)).filter((category): category is Category=>Boolean(category));
 const moreCategories=orderedCategories.filter(category=>!prioritySet.has(category.slug));
 const moreOpen=activeCategoryId==="__more__";
 const activeCategory=moreOpen?null:(categories.find(category=>category.id===activeCategoryId)??null);
 const advice=activeCategory?categoryAdvice(activeCategory):null;
 return <><header className="site-header">
  <div className="header-wide">
   <div className="header-brand-cluster">
    <a className="brand brand-modern" href="/" aria-label={`${brand.siteName}, accueil`}>{brand.logoUrl?<picture className="brand-logo-picture"><source media="(max-width: 720px)" srcSet={brand.mobileLogoUrl??brand.logoUrl}/><img className="brand-logo-img" src={brand.logoUrl} alt={brand.siteName}/></picture>:!brandResolved?<span className="brand-logo-placeholder" aria-hidden="true"/>:brand.siteName==="Petit Annonces"?<span className="brand-name"><b>Petit</b> <strong>Annonces</strong></span>:<span className="brand-name"><b>{brand.siteName}</b></span>}</a>
    <a className="mobile-account-trigger mobile-notification-trigger" href={authenticated?"/mon-compte/notifications":"/connexion?next=%2Fmon-compte%2Fnotifications"} aria-label="Notifications"><AppIcon name="bell"/>{authenticated&&summary.unreadNotifications>0&&<i className="mobile-notification-count">{summary.unreadNotifications>99?"99+":summary.unreadNotifications}</i>}</a>
   </div>
   <form ref={searchFormRef} className={`header-search header-ai-search ${pathname==="/"?"header-search-home":"header-search-inner"}`} role="search" onSubmit={submitAiSearch}>
    <span className="ai-search-mark"><AppIcon name="sparkles"/><b>IA</b></span>
    <input name="q" type="search" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onFocus={()=>{if(searchQuery.trim().length>=2)setSearchSuggestionsOpen(true)}} placeholder="Décrivez ce que vous cherchez…" aria-label="Recherche assistée par IA" aria-expanded={searchSuggestionsOpen}/>
    <button type="submit" aria-label="Rechercher" disabled={searching}>{searching?<span className="ai-search-loader"/>:<AppIcon name="arrow-right"/>}</button>
    {searchSuggestionsOpen&&searchQuery.trim().length>=2&&<div className="header-search-suggestions" role="listbox" aria-label="Annonces correspondantes">
      <div className="header-search-suggestions-head"><strong>Annonces correspondantes</strong><span>{searchSuggestionsLoading?"Recherche…":`${searchSuggestions.length} résultat${searchSuggestions.length>1?"s":""}`}</span></div>
      {searchSuggestionsLoading&&searchSuggestions.length===0?<div className="header-search-suggestion-empty">Recherche des annonces…</div>:searchSuggestions.length===0?<div className="header-search-suggestion-empty">Aucune annonce correspondante.</div>:searchSuggestions.map(item=>{const price=formatSuggestionPrice(item.priceMinor,item.currency);return <a className="header-search-suggestion" href={`/annonce/${item.value}`} key={item.id??item.value} role="option" aria-label={item.label}>
        <span className="header-search-suggestion-image">{item.imageUrl?<img src={item.imageUrl} alt=""/>:<AppIcon name="image"/>}</span>
        <span className="header-search-suggestion-copy"><strong>{item.label}</strong><small>{[price,item.city].filter(Boolean).join(" · ")||"Voir l’annonce"}</small></span>
        <AppIcon name="chevron-right"/>
      </a>})}
      <a className="header-search-suggestion-all" href={`/recherche?q=${encodeURIComponent(searchQuery.trim())}`}>Voir tous les résultats <AppIcon name="arrow-right"/></a>
    </div>}
   </form>
   <div className="header-actions header-actions-modern">
    <a className="header-icon-link" href={authenticated?"/mon-compte/favoris":"/connexion?next=%2Fmon-compte%2Ffavoris"} aria-label="Favoris"><AppIcon name="heart"/></a>
    <a className="header-icon-link" href={authenticated?"/messages":"/connexion?next=%2Fmessages"} aria-label="Messages" style={{position:"relative"}}><AppIcon name="comments"/>{authenticated&&summary.unreadConversations>0&&<i className="header-count">{summary.unreadConversations>99?"99+":summary.unreadConversations}</i>}</a>
    <a className="header-icon-link" href={authenticated?"/mon-compte/notifications":"/connexion?next=%2Fmon-compte%2Fnotifications"} aria-label="Notifications" style={{position:"relative"}}><AppIcon name="bell"/>{authenticated&&summary.unreadNotifications>0&&<i className="header-count">{summary.unreadNotifications>99?"99+":summary.unreadNotifications}</i>}</a>
    <div className="header-account-wrap">
      <a data-native-navigation="true" className={`header-user${authenticated&&accountAvatarUrl?" has-avatar":""}`} href={authenticated?(accountKind==="PROFESSIONNEL"?"/espace-pro":"/mon-compte"):"/connexion"} aria-label={authenticated?(accountKind==="PROFESSIONNEL"?"Espace Pro":"Mon compte"):"Connexion"}>{authenticated&&accountAvatarUrl?<img src={accountAvatarUrl} alt={`Photo de ${accountName}`}/>:<AppIcon name="user"/>}</a>
      {!authenticated&&<div className="header-account-menu" role="menu"><div className="header-account-welcome"><strong>Bienvenue</strong><span>Connectez-vous ou créez votre compte gratuitement.</span></div><a className="header-account-login" href="/connexion">Se connecter</a><a className="header-account-signup" href="/inscription">Créer un compte</a></div>}
    </div>
    <a className="header-post" href="/deposer-une-annonce"><AppIcon name="plus"/><span>Déposer une annonce</span></a>
   </div>
  </div>
  <div className="category-nav-shell" onMouseLeave={delayedClose}>
   <nav className="category-nav" aria-label="Catégories principales">
    {visibleCategories.map(category=><button
      type="button"
      key={category.id}
      className={activeCategoryId===category.id?"is-active":""}
      onMouseEnter={()=>scheduleCategoryOpen(category.id)}
      onFocus={()=>openCategory(category.id)}
      onClick={()=>{if(openTimer.current)clearTimeout(openTimer.current);if(category.slug==="vacances"){setActiveCategoryId(null);navigateApp(router,"/vacances");return}setActiveCategoryId(current=>current===category.id?null:category.id)}}
      aria-expanded={activeCategoryId===category.id}
    ><AppIcon name={categoryIcon(category)}/><span>{category.name}</span><AppIcon name="chevron-down"/></button>)}
    {moreCategories.length>0&&<button
      type="button"
      className={`category-more-trigger ${moreOpen?"is-active":""}`}
      onMouseEnter={()=>scheduleCategoryOpen("__more__")}
      onFocus={()=>openCategory("__more__")}
      onClick={()=>{if(openTimer.current)clearTimeout(openTimer.current);setActiveCategoryId(current=>current==="__more__"?null:"__more__")}}
      aria-expanded={moreOpen}
    ><AppIcon name="list"/><span>Autres</span><AppIcon name="chevron-down"/></button>}
   </nav>
   {moreOpen&&<div className="category-mega category-mega-more" onMouseEnter={()=>openCategory("__more__")} onMouseLeave={delayedClose}>
    <div className="category-mega-main">
     <div className="category-mega-head"><div className="category-mega-title"><i className="category-mega-title-icon" aria-hidden="true"><AppIcon name="list"/></i><div className="category-mega-title-copy"><span>Explorer</span><h2>Autres catégories</h2></div></div><a href="/recherche">Toutes les annonces <AppIcon name="arrow-right"/></a></div>
     <div className="category-more-grid">{moreCategories.map(category=><a href={`/categorie/${category.slug}`} key={category.id}><span><AppIcon name={categoryIcon(category)}/></span><div><strong>{category.name}</strong><small>{(category.children??[]).slice(0,3).map(child=>child.name).join(" · ")||"Voir les annonces"}</small></div><AppIcon name="chevron-right"/></a>)}</div>
    </div>
    <aside className="category-advice">
     <div className="category-advice-title"><span><AppIcon name="shield"/></span><div><small>Petit Annonces vous conseille</small><strong>Quelques réflexes utiles dans toutes les catégories</strong></div></div>
     <div className="category-advice-item"><AppIcon name="user-shield"/><div><b>Sécurité</b><p>Gardez vos échanges sur Petit Annonces et méfiez-vous des demandes de paiement inhabituelles ou trop urgentes.</p></div></div>
     <div className="category-advice-item"><AppIcon name="sparkles"/><div><b>Bon réflexe</b><p>Comparez plusieurs annonces, demandez des détails et vérifiez l’état réel avant de vous engager.</p></div></div>
     <a href="/conformite">Nos conseils de sécurité <AppIcon name="arrow-right"/></a>
    </aside>
   </div>}
   {activeCategory&&advice&&<div className="category-mega" onMouseEnter={()=>openCategory(activeCategory.id)} onMouseLeave={delayedClose}>
    <div className="category-mega-main">
     <div className="category-mega-head"><div className="category-mega-title"><i className="category-mega-title-icon" aria-hidden="true"><AppIcon name={categoryIcon(activeCategory)}/></i><div className="category-mega-title-copy"><span>Explorer</span><h2>{activeCategory.name}</h2></div></div><a href={activeCategory.slug==="vacances"?"/vacances":`/categorie/${activeCategory.slug}`}>Toutes les annonces <AppIcon name="arrow-right"/></a></div>
     <div className="category-mega-links">
      {(activeCategory.children??[]).length?(activeCategory.children??[]).map(child=><section key={child.id}>
       <a className="category-mega-root" href={activeCategory.slug==="vacances"?`/vacances?type=${encodeURIComponent(child.slug)}`:`/categorie/${child.slug}`}><span className="category-mega-section-icon"><AppIcon name={categoryIcon(child)}/></span><span className="category-mega-section-title">{child.name}</span><AppIcon name="chevron-right"/></a>
       {(child.children??[]).length>0&&<div>{(child.children??[]).map(leaf=><a key={leaf.id} href={`/categorie/${leaf.slug}`}>{leaf.name}</a>)}</div>}
      </section>):<a className="category-mega-empty" href={`/categorie/${activeCategory.slug}`}>Voir les annonces {activeCategory.name.toLowerCase()} <AppIcon name="arrow-right"/></a>}
     </div>
    </div>
    <aside className="category-advice">
     <div className="category-advice-title"><span><AppIcon name="shield"/></span><div><small>Petit Annonces vous conseille</small><strong>Achetez et vendez plus sereinement</strong></div></div>
     <div className="category-advice-item"><AppIcon name="user-shield"/><div><b>Sécurité</b><p>{advice.safety}</p></div></div>
     <div className="category-advice-item"><AppIcon name="sparkles"/><div><b>Bon réflexe</b><p>{advice.tip}</p></div></div>
     <a href="/conformite">Nos conseils de sécurité <AppIcon name="arrow-right"/></a>
    </aside>
   </div>}
  </div>
  </header>
  {authenticated&&<><button type="button" className={`mobile-account-backdrop ${mobileAccountOpen?"is-open":""}`} aria-label="Fermer le menu du compte" onClick={()=>setMobileAccountOpen(false)}/><aside className={`mobile-account-drawer ${mobileAccountOpen?"is-open":""}`} aria-hidden={!mobileAccountOpen} data-no-pull-refresh>
   <div className="mobile-account-drawer-head"><div className="mobile-account-identity"><span className={`mobile-account-avatar${accountAvatarUrl?" has-avatar":""}`}>{accountAvatarUrl?<img src={accountAvatarUrl} alt={`Photo de ${accountName}`}/>:<AppIcon name="user"/>}</span><div><small>{accountKind==="PROFESSIONNEL"?"Compte professionnel":"Mon espace"}</small><strong>{accountName}</strong></div></div><button type="button" aria-label="Fermer" onClick={()=>setMobileAccountOpen(false)}>×</button></div>
   <nav aria-label="Navigation du compte">
    <a href={accountKind==="PROFESSIONNEL"?"/espace-pro":"/mon-compte"}><AppIcon name="home"/><span>{accountKind==="PROFESSIONNEL"?"Tableau de bord Pro":"Mon compte"}</span></a>
    <a href={accountKind==="PROFESSIONNEL"?"/espace-pro/annonces":"/mon-compte/annonces"}><AppIcon name="list"/><span>Mes annonces</span></a>
    <a href={accountKind==="PROFESSIONNEL"?"/espace-pro/messages":"/messages"}><AppIcon name="comments"/><span>Messages</span>{summary.unreadConversations>0&&<b>{summary.unreadConversations>99?"99+":summary.unreadConversations}</b>}</a>
    <a href="/mon-compte/notifications"><AppIcon name="bell"/><span>Notifications</span>{summary.unreadNotifications>0&&<b>{summary.unreadNotifications>99?"99+":summary.unreadNotifications}</b>}</a>
    <a href="/mon-compte/favoris"><AppIcon name="heart"/><span>Favoris</span></a>
    <a href="/mon-compte/suivis"><AppIcon name="bell"/><span>Comptes suivis</span></a>
    <a href="/commandes"><AppIcon name="credit-card"/><span>Achats & ventes</span></a>
    <a href="/mon-compte/activite"><AppIcon name="gauge"/><span>Mon activité</span></a>
    <a href="/mon-compte/reputation"><AppIcon name="star"/><span>Réputation & badges</span></a>
    <a href="/mon-compte/portefeuille"><AppIcon name="wallet"/><span>Crédit Petit Annonces</span></a>
    <a href="/parrainage"><AppIcon name="handshake"/><span>Parrainage · gagnez 5 €</span></a>
    <a href="/mon-compte/paiements"><AppIcon name="credit-card"/><span>IBAN & versements</span></a>
    <a href="/assistance"><AppIcon name="comments"/><span>Support & assistance</span></a>
    {accountKind!=="PROFESSIONNEL"&&<a className="mobile-account-pro-cta" href="/professionnels"><AppIcon name="briefcase"/><span><strong>Passer en compte Pro</strong><small>Découvrez les outils pour professionnels</small></span><AppIcon name="chevron-right"/></a>}
    <div className="mobile-account-separator"/>
    <a href="/mon-compte/profil"><AppIcon name="user-shield"/><span>Profil & vérification</span></a>
    <a href="/mon-compte/adresses"><AppIcon name="location"/><span>Adresses</span></a>
    <a href="/mon-compte/recherches"><AppIcon name="search"/><span>Recherches enregistrées</span></a>
    <a href="/mon-compte/securite"><AppIcon name="shield"/><span>Sécurité</span></a>
    <a href="/mon-compte/parametres"><AppIcon name="gears"/><span>Paramètres</span></a>
    {accountKind==="PROFESSIONNEL"&&<><a href="/espace-pro/ventes"><AppIcon name="credit-card"/><span>Ventes</span></a><a href="/espace-pro/visibilite"><AppIcon name="sparkles"/><span>Visibilité</span></a><a href="/espace-pro/boutiques"><AppIcon name="store"/><span>Mes boutiques</span></a><a href="/espace-pro/analytics"><AppIcon name="gauge"/><span>Analytics</span></a><a href="/espace-pro/abonnement"><AppIcon name="briefcase"/><span>Abonnement</span></a><a href="/espace-pro/entreprise"><AppIcon name="user-shield"/><span>Entreprise & profil</span></a></>}
   </nav>
   <button type="button" className="mobile-account-logout" onClick={()=>void logout()}><AppIcon name="door"/><span>Se déconnecter</span></button>
  </aside></>}
 </>;
}
