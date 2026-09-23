import { adminServerFetch } from "../../../lib/server-api";
import { AdminIcon } from "../../../components/admin-icon";

type LocalOpportunity={categorySlug:string;categoryName:string;city:string;count:number;recent30:number;priceCoveragePct:number;mediaCoveragePct:number;avgDescriptionChars:number;href:string};
type GscSeoOpportunity={id:string;type:"QUICK_WIN"|"CTR_GAP"|"CONTENT_GAP"|"CANNIBALIZATION"|"LEGACY_URL";priority:"HIGH"|"MEDIUM"|"LOW";score:number;query:string|null;page:string|null;competingPages:string[];clicks:number;impressions:number;ctr:number;position:number;estimatedExtraClicks:number;title:string;reason:string;action:string};
type GscLive={connected:boolean;siteUrl:string;serviceAccountEmail:string|null;errorCode:string|null;errorMessage:string|null;settledThrough:string|null;performance:{days:number;clicks:number;impressions:number;ctr:number;position:number};topQueries:Array<{query:string;clicks:number;impressions:number;ctr:number;position:number}>;topPages:Array<{page:string;clicks:number;impressions:number;ctr:number;position:number}>;opportunities:Array<{query:string;clicks:number;impressions:number;ctr:number;position:number}>;seoOpportunities:GscSeoOpportunity[];opportunityCounts:{high:number;medium:number;low:number;quickWins:number;ctrGaps:number;contentGaps:number;cannibalization:number;legacyUrls:number;resolvedRedirects:number};source:"GSC_API"};
type SeoStatus={
 generatedAt:string;
 inventory:{publishedListings:number;activeCategories:number;activeStores:number;localLandingPairs:number;indexableLocalPages:number};
 indexHygiene:{indexableCategories:number;indexableCities:number;noindexCities:number;indexableLocalPages:number;noindexLocalPages:number};
 issues:{missingTitle:number;missingDescription:number;missingSlug:number;missingMedia:number;total:number};
 opportunities:{
  livePages:LocalOpportunity[];
  nearThreshold:LocalOpportunity[];
  oneListing:LocalOpportunity[];
  categories:Array<{slug:string;name:string;count:number;recent30:number}>;
  cities:Array<{city:string;count:number;recent30:number;href:string}>;
  recommendedActions:Array<{code:string;title:string;detail:string;priority:"HIGH"|"MEDIUM"|"LOW"}>;
 };
 gsc:null|{siteUrl:string;syncedAt:string;settledThrough:string;performance:{days:number;clicks:number;impressions:number;ctr:number;position:number};sitemap:{url:string;submitted:number;indexed:number;errors:number;warnings:number;lastDownloaded:string;liveUrlCount:number;performanceVisibleUrls:number};inspection:{home:{verdict:string;coverageState:string;lastCrawlTime?:string};category:{verdict:string;coverageState:string};listing:{verdict:string;coverageState:string}}};
 gscLive:GscLive;
 endpoints:{sitemap:string;robots:string};
};
const fmt=(n:number)=>new Intl.NumberFormat("fr-FR").format(n??0);
const pct=(n:number)=>`${Number(n??0).toLocaleString("fr-FR",{maximumFractionDigits:0})} %`;
const dt=(v?:string)=>v?new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Paris"}).format(new Date(v)):"—";
function healthClass(ok:boolean){return ok?"admin-seo-good":"admin-seo-warn"}
function priorityClass(value:string){return value==="HIGH"?"admin-seo-warn":"admin-seo-good"}
function seoTypeLabel(type:GscSeoOpportunity["type"]){return ({QUICK_WIN:"Gain rapide",CTR_GAP:"CTR",CONTENT_GAP:"Contenu",CANNIBALIZATION:"Cannibalisation",LEGACY_URL:"URL technique"} as const)[type]}
function displayPage(value:string|null){if(!value)return"";try{const u=new URL(value);return `${u.pathname}${u.search}`||"/"}catch{return value}}
const BACKLINK_TARGETS=[
 {name:"Libpress",href:"https://libpress.fr/connexion?next=/publier",priority:"HIGH",status:"Publication directe",detail:"Réponse reçue le 23/09 : publication possible depuis un compte Libpress. Publication gratuite disponible; l’option avec backlink SEO est payante."},
 {name:"J'aime les Startups",href:"https://www.jaimelesstartups.fr/ajouter-une-startup/",priority:"HIGH",status:"Soumis 22/09",detail:"Soumission envoyée à contact@jaimelesstartups.fr avec pitch, site, page presse et communiqué; attente de retour."},
 {name:"Prouct",href:"https://www.prouct.com/fr/soumettre",priority:"MEDIUM",status:"Soumis 23/09",detail:"Dossier complet envoyé à hello@prouct.com avec site, accroche, description, fonctionnalités, cas d’usage, avantages, page presse et Observatoire; attente de retour ou demande de champs complémentaires."},
 {name:"Bloob",href:"https://bloob.fr/connexion?next=/publier",priority:"MEDIUM",status:"Publication directe",detail:"Canal de publication communiqué par l’équipe Libpress le 23/09; nécessite un compte. À utiliser sans achat tant qu’une option payante n’est pas validée."},
 {name:"MyFrenchStartup",href:"https://www.myfrenchstartup.com/fr/",priority:"MEDIUM",status:"Soumis 22/09",detail:"Demande de référencement envoyée à contact@myfrenchstartup.com avec site, page presse et communiqué; attente de procédure/validation."},
 {name:"UNIKT",href:"https://unikt.fr/",priority:"MEDIUM",status:"Soumis 22/09",detail:"Soumission envoyée par e-mail à contact@unikt.fr avec présentation, site, page presse et communiqué; attente de validation."},
 {name:"Les Pépites Tech",href:"https://lespepitestech.com/nos-offres",priority:"HIGH",status:"Soumis 22/09",detail:"Demande de référencement Starter gratuit envoyée à bonjour@lespepitestech.com; attente de modération/procédure."},
 {name:"Bref Eco",href:"https://www.brefeco.com/contact",priority:"HIGH",status:"Soumis 22/09",detail:"Pitch éditorial et Observatoire envoyés à redaction@brefeco.com; attente de retour."},
 {name:"Siècle Digital",href:"https://siecledigital.fr/contact/",priority:"HIGH",status:"Soumis 22/09",detail:"Pitch marketplace + Observatoire envoyé à redaction@siecledigital.fr; attente de retour."},
 {name:"Presse-citron",href:"https://www.presse-citron.net/contact/",priority:"MEDIUM",status:"Soumis 22/09",detail:"Présentation produit + Observatoire envoyée à contact@presse-citron.net; attente de retour."},
 {name:"FrenchWeb / FW.MEDIA",href:"https://www.frenchweb.fr/contacter-la-redaction",priority:"MEDIUM",status:"Formulaire requis",detail:"La rédaction demande d’abord une inscription/whitelist via son formulaire avant l’envoi d’informations à redaction@fw.media; procédure à respecter."},
 {name:"Maddyness",href:"https://www.maddyness.com/kit-media/",priority:"MEDIUM",status:"Formulaire requis",detail:"Pitch startup via formulaire média; soumission non envoyée sans les coordonnées obligatoires du formulaire."},
 {name:"INDEXA",href:"https://indexa.fr/register",priority:"LOW",status:"Option payante",detail:"Catégorie dédiée aux sites de petites annonces; inscription standard actuellement payante."},
] as const;
const CONTENT_GAPS=[
 {topic:"Vendre un objet d’occasion",status:"Publié",href:"https://petitannonces.fr/blog/vendre-objet-occasion",detail:"Couvre l’intention vendre d’occasion avec prix, photos, description et remise."},
 {topic:"Vendre entre particuliers",status:"Publié",href:"https://petitannonces.fr/blog/vendre-entre-particuliers",detail:"Checklist transactionnelle inspirée des besoins observés chez les grands acteurs, avec contenu original Petit Annonces."},
 {topic:"Rédiger une annonce efficace",status:"Publié",href:"https://petitannonces.fr/blog/rediger-annonce-efficace",detail:"Renforce les intentions liées à la qualité d’une annonce et soutient les catégories."},
 {topic:"Annonce immobilière entre particuliers",status:"Publié",href:"https://petitannonces.fr/blog/rediger-annonce-immobiliere",detail:"Comble le manque de contenu immobilier pratique autour de la rédaction et de la publication."},
 {topic:"Acheter un smartphone d’occasion",status:"Publié",href:"https://petitannonces.fr/blog/acheter-smartphone-occasion",detail:"Couvre un besoin high-tech transactionnel avec une checklist avant achat."},
 {topic:"Données locales & tendances",status:"Publié",href:"https://petitannonces.fr/observatoire",detail:"Actif différenciant et linkable : villes, catégories, activité récente et prix médians affichés."},
 {topic:"Prix & tendances par catégorie",status:"À étendre",href:"https://petitannonces.fr/observatoire",detail:"Étendre lorsque chaque catégorie dispose d’un volume suffisant pour éviter des statistiques fragiles."},
 {topic:"Guides spécialisés automobile",status:"À étendre",href:"https://petitannonces.fr/vendre-voiture",detail:"Créer ensuite des sous-guides uniquement lorsque Search Console ou le catalogue montre une demande réelle."},
] as const;
const SUBMISSION_KIT=[
 {name:"Libpress",fields:[
  ["Titre","Petit Annonces développe une marketplace française de petites annonces"],
  ["Extrait","Petit Annonces poursuit le développement d’une plateforme française pensée pour publier gratuitement, rechercher localement et réunir particuliers et professionnels autour de l’achat et de la vente."],
  ["URL source","https://petitannonces.fr/presse/petit-annonces-marketplace-francaise"],
  ["Catégorie suggérée","Tech / Économie"],
  ["Région","France"],
 ]},
 {name:"J’aime les Startups",fields:[
  ["Phrase 120–160 caractères","Petit Annonces simplifie la publication, la recherche et la vente de petites annonces en France pour particuliers et professionnels."],
  ["Que proposez-vous ?","Une plateforme française de petites annonces permettant de publier, rechercher, acheter et vendre dans plusieurs catégories, avec des pages locales, des comptes professionnels et des outils adaptés au mobile."],
  ["Comment avez-vous eu l’idée ?","Le projet part d’un constat simple : publier et retrouver une annonce locale peut encore être complexe, tandis que les professionnels ont besoin d’outils plus structurés pour gérer leur catalogue et leur visibilité."],
  ["Pourquoi vous lancer ?","Créer une alternative française moderne, plus simple à utiliser sur mobile, capable de servir à la fois les particuliers et les professionnels avec des parcours adaptés à chaque usage."],
  ["Besoin adressé","Faciliter la publication gratuite, la découverte locale des annonces et la gestion d’un volume plus important d’annonces pour les professionnels."],
  ["Cœur de cible","Particuliers en France, commerces, garages, professionnels de l’occasion, immobilier, services et autres vendeurs réguliers."],
  ["Acquisition","SEO local et catégories, contenu, partenariats, référencement presse, acquisition professionnelle et campagnes digitales mesurées."],
  ["Business model","Services et options de visibilité, offres professionnelles et services associés à certaines transactions ou fonctionnalités de marketplace."],
  ["Technologies","Next.js, Node.js, TypeScript, PostgreSQL, Redis, PWA et intégrations de services tiers selon les fonctionnalités."],
  ["Besoins actuels","Notoriété, partenariats éditoriaux, acquisition d’utilisateurs et de professionnels, enrichissement du catalogue et développement de l’autorité SEO."],
  ["Concurrents","Leboncoin, ParuVendu, Facebook Marketplace et autres plateformes généralistes ou spécialisées de petites annonces."],
  ["Différenciation","Expérience mobile/PWA, organisation locale par ville, outils Pro, import d’annonces existantes, parcours spécialisés et amélioration continue des fonctions de confiance et de modération."],
  ["Dans un an","Disposer d’un catalogue plus dense dans les principales villes françaises, renforcer l’offre professionnelle et accroître la visibilité organique de la plateforme."],
 ]},
 {name:"Prouct",fields:[
  ["Nom","Petit Annonces"],
  ["URL","https://petitannonces.fr"],
  ["Accroche","La marketplace française de petites annonces pour particuliers et professionnels."],
  ["Description","Publiez gratuitement, recherchez par catégorie et par ville, achetez ou vendez en France et utilisez des outils dédiés aux professionnels depuis une expérience pensée pour le web et le mobile."],
  ["Modèle tarifaire","Freemium"],
  ["Emplacement","France"],
  ["Fonctionnalités clés","Dépôt d’annonce gratuit\nRecherche par catégorie et ville\nComptes et vitrines professionnelles\nMessagerie et gestion de compte\nImport d’annonces existantes\nPWA et expérience mobile\nModération et signalement"],
  ["Cas d’usage","Vendre un objet d’occasion\nRechercher une annonce locale\nPublier un catalogue professionnel\nPrésenter une boutique ou un commerce\nPromouvoir des annonces et gérer leur visibilité"],
  ["Avantages","Publication simple\nRecherche locale\nParcours particuliers et professionnels\nCatalogue multi-catégories\nExpérience mobile"],
  ["À renseigner manuellement","Adresse légale, taille de l’équipe, réseaux sociaux officiels et coordonnées de contact requises par le formulaire."],
 ]},
] as const;

export default async function SeoPage(){
 const d=await adminServerFetch<SeoStatus>("/admin/seo/status");
 if(!d)return <div className="admin-card admin-section"><h1>SEO & Google</h1><p>Données SEO indisponibles.</p></div>;
 const g=d.gsc;
 const live=d.gscLive;
 const perf=live?.connected?live.performance:g?.performance;
 const issueRows=[['Titres manquants',d.issues.missingTitle],['Descriptions manquantes',d.issues.missingDescription],['Slugs manquants',d.issues.missingSlug],['Annonces sans photo',d.issues.missingMedia]] as const;
 return <>
  <div className="admin-page-head"><div><p>Visibilité organique</p><h1>SEO & Google</h1><span className="subtitle">Santé technique, indexation et opportunités de croissance calculées sur le catalogue réel.</span></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><a className="admin-btn" href={d.endpoints.sitemap} target="_blank" rel="noreferrer"><AdminIcon name="external"/>Sitemap</a><a className="admin-btn" href={d.endpoints.robots} target="_blank" rel="noreferrer"><AdminIcon name="external"/>Robots.txt</a></div></div>

  <div className="admin-grid admin-kpis">
   <article className="admin-card admin-kpi"><div className="admin-kpi-top"><small>Pages locales indexables</small><span className="admin-kpi-icon"><AdminIcon name="growth"/></span></div><strong>{fmt(d.inventory.indexableLocalPages)}</strong><p>Seuil automatique : au moins 3 annonces</p></article>
   <article className="admin-card admin-kpi"><div className="admin-kpi-top"><small>Impressions Google</small><span className="admin-kpi-icon"><AdminIcon name="search"/></span></div><strong>{fmt(perf?.impressions??0)}</strong><p>{live?.connected?`API live · données stabilisées au ${live.settledThrough}`:g?`Snapshot · ${g.settledThrough}`:'Search Console API à connecter'}</p></article>
   <article className="admin-card admin-kpi"><div className="admin-kpi-top"><small>Clics Google</small><span className="admin-kpi-icon"><AdminIcon name="growth"/></span></div><strong>{fmt(perf?.clicks??0)}</strong><p>CTR {pct(perf?.ctr??0)} · position {Number(perf?.position??0).toLocaleString("fr-FR",{maximumFractionDigits:1})}</p></article>
   <article className="admin-card admin-kpi"><div className="admin-kpi-top"><small>Annonces publiées</small><span className="admin-kpi-icon"><AdminIcon name="list"/></span></div><strong>{fmt(d.inventory.publishedListings)}</strong><p>{fmt(d.inventory.activeCategories)} catégories actives</p></article>
  </div>

  <div className="admin-grid admin-two-col" style={{marginTop:16}}>
   <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Actions prioritaires</h2><p>Recommandations déterministes basées sur l’inventaire actuel.</p></div></div>
    {d.opportunities.recommendedActions.length?<div className="admin-seo-list">{d.opportunities.recommendedActions.map(action=><div key={action.code} style={{alignItems:'flex-start'}}><span><strong style={{display:'block',color:'#242534',marginBottom:4}}>{action.title}</strong><small style={{lineHeight:1.5}}>{action.detail}</small></span><strong className={priorityClass(action.priority)}>{action.priority==='HIGH'?'Prioritaire':'À optimiser'}</strong></div>)}</div>:<p>Aucune action prioritaire détectée sur le catalogue actuel.</p>}
   </section>
   <aside className="admin-card admin-section"><div className="admin-section-head"><div><h2>Qualité SEO interne</h2><p>Problèmes détectés dans les annonces publiées.</p></div><span className={healthClass(d.issues.total===0)}>{d.issues.total===0?'Aucun blocage':`${d.issues.total} point${d.issues.total>1?'s':''}`}</span></div><div className="admin-seo-list">{issueRows.map(([label,value])=><div key={label}><span>{label}</span><strong className={healthClass(value===0)}>{fmt(value)}</strong></div>)}</div></aside>
  </div>

  <div className="admin-grid admin-two-col" style={{marginTop:16}}>
   <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Hygiène d’indexation</h2><p>Inventaire réel calculé sur tout le catalogue, sans limite des 250 premières combinaisons.</p></div><span className="admin-seo-good">Seuil local : 3 annonces</span></div><div className="admin-seo-list"><div><span>Catégories avec inventaire indexable</span><strong>{fmt(d.indexHygiene.indexableCategories)}</strong></div><div><span>Villes indexables</span><strong>{fmt(d.indexHygiene.indexableCities)}</strong></div><div><span>Villes volontairement noindex</span><strong>{fmt(d.indexHygiene.noindexCities)}</strong></div><div><span>Pages catégorie × ville indexables</span><strong>{fmt(d.indexHygiene.indexableLocalPages)}</strong></div><div><span>Combinaisons locales sous le seuil</span><strong>{fmt(d.indexHygiene.noindexLocalPages)}</strong></div></div><p style={{margin:'12px 0 0',fontSize:12,color:'var(--muted)'}}>Les pages locales sous le seuil restent accessibles mais ne doivent pas entrer dans l’index tant que l’inventaire n’est pas suffisant.</p></section>
   <aside className="admin-card admin-section"><div className="admin-section-head"><div><h2>Backlinks & PR</h2><p>Première file de prospection vérifiée pour développer l’autorité de domaine en France.</p></div><span className="admin-seo-warn">{BACKLINK_TARGETS.filter(x=>x.priority==='HIGH').length} prioritaires</span></div><div className="admin-seo-list">{BACKLINK_TARGETS.map(target=><div key={target.name} style={{alignItems:'flex-start'}}><span><a href={target.href} target="_blank" rel="noreferrer" style={{fontWeight:850,color:'#5143d7',textDecoration:'none'}}>{target.name} <AdminIcon name="external"/></a><small style={{display:'block',marginTop:4,lineHeight:1.45}}>{target.detail}</small></span><strong className={target.priority==='HIGH'?"admin-seo-warn":"admin-seo-good"}>{target.status}</strong></div>)}</div></aside>
  </div>

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Écarts de contenu concurrents</h2><p>Intentions utiles observées chez les grands acteurs et couverture actuelle de Petit Annonces.</p></div><span className="admin-seo-good">{CONTENT_GAPS.filter(x=>x.status==="Publié").length} couverts</span></div><div className="admin-seo-list">{CONTENT_GAPS.map(item=><div key={item.topic} style={{alignItems:"flex-start"}}><span><a href={item.href} target="_blank" rel="noreferrer" style={{fontWeight:850,color:"#5143d7",textDecoration:"none"}}>{item.topic}</a><small style={{display:"block",marginTop:4,lineHeight:1.45}}>{item.detail}</small></span><strong className={item.status==="Publié"?"admin-seo-good":"admin-seo-warn"}>{item.status}</strong></div>)}</div></section>

  <section className="admin-card admin-section" style={{marginTop:16}}>
   <div className="admin-section-head"><div><h2>Kit de soumission backlinks</h2><p>Textes prêts à copier pour les premières plateformes de référencement et de presse.</p></div><a className="admin-btn" href="/presse/petit-annonces-marketplace-francaise" target="_blank" rel="noreferrer"><AdminIcon name="external"/>Communiqué officiel</a></div>
   <div style={{display:'grid',gap:12}}>{SUBMISSION_KIT.map(pack=><details key={pack.name} style={{border:'1px solid #e7e7ef',borderRadius:14,background:'#fbfbfe',padding:'14px 16px'}}><summary style={{cursor:'pointer',fontWeight:900,color:'#292a35'}}>{pack.name}</summary><div style={{display:'grid',gap:10,marginTop:12}}>{pack.fields.map(([label,value])=><div key={label} style={{display:'grid',gap:5}}><strong style={{fontSize:12,color:'#565765'}}>{label}</strong><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:0,padding:'10px 12px',borderRadius:10,background:'#fff',border:'1px solid #ececf2',fontFamily:'inherit',fontSize:12,lineHeight:1.55,color:'#343542'}}>{value}</pre></div>)}</div></details>)}</div>
  </section>

  {live?.connected&&live.seoOpportunities.length>0&&<section className="admin-card admin-section" style={{marginTop:16}}>
   <div className="admin-section-head"><div><h2>Opportunités SEO Google</h2><p>Priorisation automatique à partir des requêtes, positions, CTR et URL réellement observées dans Search Console.</p></div><span className={live.opportunityCounts.high?"admin-seo-warn":"admin-seo-good"}>{live.opportunityCounts.high} prioritaire{live.opportunityCounts.high>1?'s':''}</span></div>
   <div className="admin-grid admin-kpis" style={{marginBottom:14}}>
    <article className="admin-card admin-kpi"><small>Gains rapides</small><strong>{fmt(live.opportunityCounts.quickWins)}</strong><p>positions 4–20 à renforcer</p></article>
    <article className="admin-card admin-kpi"><small>CTR à travailler</small><strong>{fmt(live.opportunityCounts.ctrGaps)}</strong><p>bon ranking, extrait Google sous-performant</p></article>
    <article className="admin-card admin-kpi"><small>Cannibalisation</small><strong>{fmt(live.opportunityCounts.cannibalization)}</strong><p>plusieurs URL pour une même requête</p></article>
    <article className="admin-card admin-kpi"><small>URL techniques</small><strong>{fmt(live.opportunityCounts.legacyUrls)}</strong><p>{fmt(live.opportunityCounts.resolvedRedirects)} redirection(s) déjà corrigée(s) · seules les URL non résolues restent ici</p></article>
   </div>
   <div style={{display:'grid',gap:10}}>{live.seoOpportunities.slice(0,12).map(item=><article className="admin-card" key={item.id} style={{padding:14,display:'flex',gap:14,justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap'}}>
    <div style={{minWidth:0,flex:'1 1 520px'}}><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:5}}><span className={item.priority==='HIGH'?"admin-seo-warn":"admin-seo-good"}>{seoTypeLabel(item.type)}</span><strong style={{color:'#242534'}}>{item.query??item.title}</strong></div><small style={{display:'block',color:'var(--muted)',lineHeight:1.45}}>{item.reason}</small>{item.page&&<code style={{display:'block',marginTop:5,overflowWrap:'anywhere'}}>{displayPage(item.page)}</code>}{item.competingPages.length>1&&<small style={{display:'block',marginTop:5,overflowWrap:'anywhere'}}>URL en concurrence : {item.competingPages.map(displayPage).join(' · ')}</small>}<p style={{margin:'8px 0 0',lineHeight:1.5}}>{item.action}</p></div>
    <div style={{textAlign:'right',minWidth:92}}><strong style={{display:'block',fontSize:22}}>{item.score}/100</strong><small>{item.priority==='HIGH'?'Prioritaire':item.priority==='MEDIUM'?'À optimiser':'À surveiller'}</small>{item.estimatedExtraClicks>0&&<small style={{display:'block',marginTop:5}}>+{item.estimatedExtraClicks} clic(s) potentiel(s)</small>}</div>
   </article>)}</div>
   <p style={{margin:'12px 0 0',color:'var(--muted)',fontSize:12}}>Le score est un indicateur de priorisation interne, pas une prédiction de classement. Les estimations de clics utilisent des CTR de référence conservateurs selon la position actuelle. Aucune modification SEO n’est appliquée automatiquement.</p>
  </section>}

  <section className="admin-card admin-section" style={{marginTop:16}}><div className="admin-section-head"><div><h2>Landing pages locales les plus fortes</h2><p>Pages catégorie × ville déjà au-dessus du seuil indexable.</p></div><span className="admin-seo-good">{fmt(d.inventory.indexableLocalPages)} actives</span></div>
   <div className="admin-seo-list">{d.opportunities.livePages.slice(0,12).map(row=><div key={`${row.categorySlug}:${row.city}`}><span><a href={row.href} target="_blank" rel="noreferrer" style={{fontWeight:850,color:'#5143d7',textDecoration:'none'}}>{row.categoryName} · {row.city}</a><small style={{display:'block',marginTop:3}}>{row.recent30} nouvelle{row.recent30>1?'s':''} sur 30 j · photos {pct(row.mediaCoveragePct)} · prix {pct(row.priceCoveragePct)}</small></span><strong>{fmt(row.count)} annonces</strong></div>)}</div>
  </section>

  <div className="admin-grid admin-two-col" style={{marginTop:16}}>
   <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>À une annonce du seuil</h2><p>Ces pages ont 2 annonces : une seule annonce pertinente supplémentaire les rend indexables.</p></div><span className={d.opportunities.nearThreshold.length?"admin-seo-warn":"admin-seo-good"}>{fmt(d.opportunities.nearThreshold.length)} opportunité{d.opportunities.nearThreshold.length>1?'s':''}</span></div>
    {d.opportunities.nearThreshold.length?<div className="admin-seo-list">{d.opportunities.nearThreshold.slice(0,12).map(row=><div key={`${row.categorySlug}:${row.city}`}><span>{row.categoryName} · {row.city}<small style={{display:'block',marginTop:3}}>Photos {pct(row.mediaCoveragePct)} · description moy. {fmt(row.avgDescriptionChars)} caractères</small></span><strong>2 / 3</strong></div>)}</div>:<p>Aucune page n’est actuellement bloquée exactement à 2 annonces.</p>}
   </section>
   <aside className="admin-card admin-section"><div className="admin-section-head"><div><h2>Prochain vivier</h2><p>Couples catégorie × ville avec une seule annonce, à renforcer après les pages 2/3.</p></div></div><div className="admin-seo-list">{d.opportunities.oneListing.slice(0,8).map(row=><div key={`${row.categorySlug}:${row.city}`}><span>{row.categoryName} · {row.city}</span><strong>1 / 3</strong></div>)}</div></aside>
  </div>

  <div className="admin-grid admin-two-col" style={{marginTop:16}}>
   <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Catégories qui concentrent le catalogue</h2><p>Prioriser acquisition et contenu là où l’inventaire existe déjà.</p></div></div><div className="admin-seo-list">{d.opportunities.categories.slice(0,10).map(row=><div key={row.slug}><span>{row.name}<small style={{display:'block',marginTop:3}}>{row.recent30} ajout{row.recent30>1?'s':''} sur 30 j</small></span><strong>{fmt(row.count)}</strong></div>)}</div></section>
   <aside className="admin-card admin-section"><div className="admin-section-head"><div><h2>Villes les plus denses</h2><p>Hubs locaux ayant le plus de potentiel organique immédiat.</p></div></div><div className="admin-seo-list">{d.opportunities.cities.slice(0,10).map(row=><div key={row.city}><span><a href={row.href} target="_blank" rel="noreferrer" style={{fontWeight:850,color:'#5143d7',textDecoration:'none'}}>{row.city}</a><small style={{display:'block',marginTop:3}}>{row.recent30} ajout{row.recent30>1?'s':''} sur 30 j</small></span><strong>{fmt(row.count)}</strong></div>)}</div></aside>
  </div>

  <div className="admin-grid admin-two-col" style={{marginTop:16}}>
   <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Google Search Console</h2><p>{live?.connected?`API directe active pour ${live.siteUrl}.`:live?.errorCode==='api_disabled'?'Search Console API doit être activée dans Google Cloud.':live?.errorCode==='permission_missing'?'API active mais le compte de service doit être ajouté à Search Console.':g?`Fallback snapshot disponible pour ${g.siteUrl}.`:'Connexion live indisponible : aucune donnée de ranking inventée.'}</p></div><span className={healthClass(Boolean(live?.connected))}>{live?.connected?'API live':live?.errorCode==='api_disabled'?'API à activer':live?.errorCode==='permission_missing'?'Accès requis':'Fallback'}</span></div>
    {live?.connected?<><div className="admin-seo-list"><div><span>Clics · {live.performance.days} j</span><strong>{fmt(live.performance.clicks)}</strong></div><div><span>Impressions</span><strong>{fmt(live.performance.impressions)}</strong></div><div><span>CTR</span><strong>{pct(live.performance.ctr)}</strong></div><div><span>Position moyenne</span><strong>{live.performance.position.toLocaleString('fr-FR',{maximumFractionDigits:1})}</strong></div></div>{live.opportunities.length>0&&<div style={{marginTop:14}}><h3>Requêtes à pousser (positions 5–20)</h3><div className="admin-seo-list">{live.opportunities.slice(0,8).map(row=><div key={row.query}><span>{row.query}<small style={{display:'block',marginTop:3}}>{fmt(row.impressions)} impressions · CTR {pct(row.ctr)}</small></span><strong>#{row.position.toLocaleString('fr-FR',{maximumFractionDigits:1})}</strong></div>)}</div></div>}</>:<><div className="admin-card" style={{padding:14,borderStyle:'dashed'}}><strong>{live?.errorMessage??'Search Console API non connectée'}</strong>{live?.serviceAccountEmail&&<small style={{display:'block',marginTop:6,overflowWrap:'anywhere'}}>{live.serviceAccountEmail}</small>}</div>{g&&<div className="admin-seo-list" style={{marginTop:14}}><div><span>Dernier snapshot</span><strong>{dt(g.syncedAt)}</strong></div><div><span>Impressions snapshot</span><strong>{fmt(g.performance.impressions)}</strong></div></div>}</>}
   </section>
   <aside className="admin-card admin-section"><div className="admin-section-head"><div><h2>Inventaire indexable</h2><p>Contenu exposé aux moteurs et base de croissance disponible.</p></div></div><div className="admin-seo-list"><div><span>Annonces publiées</span><strong>{fmt(d.inventory.publishedListings)}</strong></div><div><span>Catégories actives</span><strong>{fmt(d.inventory.activeCategories)}</strong></div><div><span>Vitrines actives</span><strong>{fmt(d.inventory.activeStores)}</strong></div><div><span>Combinaisons leaf catégorie × ville</span><strong>{fmt(d.inventory.localLandingPairs)}</strong></div><div><span>Landing pages locales indexables</span><strong>{fmt(d.inventory.indexableLocalPages)}</strong></div></div></aside>
  </div>
 </>;
}