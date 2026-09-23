type MaintenanceSite={siteName:string;logoUrl:string|null;accentColor:string};
type City={name:string;x:number;y:number;tx:number;ty:number;featured?:boolean};

const cities:City[]=[
  {name:"Lille",x:1017,y:291,tx:1048,ty:270},{name:"Paris",x:938,y:589,tx:970,ty:572,featured:true},
  {name:"Rennes",x:485,y:710,tx:360,ty:692},{name:"Nantes",x:499,y:855,tx:365,ty:875},
  {name:"Bordeaux",x:609,y:1228,tx:455,ty:1260},{name:"Toulouse",x:836,y:1415,tx:690,ty:1455},
  {name:"Lyon",x:1216,y:1085,tx:1250,ty:1123,featured:true},{name:"Marseille",x:1276,y:1461,tx:1315,ty:1510},
  {name:"Nice",x:1489,y:1399,tx:1522,ty:1428},{name:"Strasbourg",x:1544,y:636,tx:1580,ty:620},
];

function MaintenanceMap(){
 return <div className="pa-maintenance-map-card" aria-label="Petit Annonces partout en France">
  <div className="pa-maintenance-map-glow" aria-hidden="true"/>
  <div className="pa-maintenance-map-stack">
   <img src="/france-hero-map.svg" alt="Carte de la France métropolitaine" width="1796" height="1797" decoding="async"/>
   <svg viewBox="0 0 1796 1797" role="img" aria-label="Réseau Petit Annonces en France">
    <g className="pa-maintenance-routes" fill="none"><path d="M938 589 C1040 660 1165 860 1216 1085"/><path d="M1216 1085 C1270 1188 1300 1335 1276 1461"/><path d="M609 1228 C625 970 745 730 938 589"/><path d="M836 1415 C965 1335 1090 1215 1216 1085"/></g>
    <g className="pa-maintenance-route-logo" transform="translate(1010 895)"><rect x="-82" y="-52" width="164" height="104" rx="32"/><image href="/pwa-loading-logo.svg" x="-54" y="-30" width="108" height="60" preserveAspectRatio="xMidYMid meet"/></g>
    <g className="pa-maintenance-motion pa-maintenance-package"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="6.4s" repeatCount="indefinite" path="M938 589 C1040 660 1165 860 1216 1085"/></g>
    <g className="pa-maintenance-motion pa-maintenance-money"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="6.4s" begin="-3.1s" repeatCount="indefinite" path="M1216 1085 C1165 860 1040 660 938 589"/></g>
    <g className="pa-maintenance-motion pa-maintenance-package"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="7s" begin="-1.6s" repeatCount="indefinite" path="M1216 1085 C1270 1188 1300 1335 1276 1461"/></g>
    <g className="pa-maintenance-motion pa-maintenance-money"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="7s" begin="-4.7s" repeatCount="indefinite" path="M1276 1461 C1300 1335 1270 1188 1216 1085"/></g>
    <g className="pa-maintenance-motion pa-maintenance-package"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="7.5s" begin="-2s" repeatCount="indefinite" path="M609 1228 C625 970 745 730 938 589"/></g>
    <g className="pa-maintenance-motion pa-maintenance-money"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="7.5s" begin="-5.5s" repeatCount="indefinite" path="M938 589 C745 730 625 970 609 1228"/></g>
    {cities.map(city=><g key={city.name} className={city.featured?"is-featured":""}><circle className="pa-maintenance-city-ring" cx={city.x} cy={city.y} r={city.featured?34:25}/><circle className="pa-maintenance-city-dot" cx={city.x} cy={city.y} r={city.featured?15:10}/><text className="pa-maintenance-city-label" x={city.tx} y={city.ty}>{city.name}</text></g>)}
   </svg>
  </div>
  <div className="pa-maintenance-map-chip pa-maintenance-map-chip-one"><span>●</span><div><strong>France entière</strong><small>Le réseau reste prêt</small></div></div>
  <div className="pa-maintenance-map-chip pa-maintenance-map-chip-two"><b>€</b><div><strong>Plus simple</strong><small>Une expérience améliorée</small></div></div>
 </div>;
}

export function MaintenanceScreen({site,preview=false}:{site:MaintenanceSite;preview?:boolean}){
 const accent=site.accentColor||"#5b4cf0";
 return <main className={`pa-maintenance${preview?" pa-maintenance-preview":""}`} style={{"--pa-maintenance-accent":accent} as React.CSSProperties}>
  <div className="pa-maintenance-orb pa-maintenance-orb-a" aria-hidden="true"/><div className="pa-maintenance-orb pa-maintenance-orb-b" aria-hidden="true"/>
  <div className="pa-maintenance-shell">
   <header className="pa-maintenance-header">
    <a href="/" className="pa-maintenance-brand" aria-label={site.siteName}>{site.logoUrl?<img src={site.logoUrl} alt={site.siteName}/>:<><span>PA</span><strong>{site.siteName}</strong></>}</a>
    <div className="pa-maintenance-status"><i/><span>{preview?"Aperçu du mode maintenance":"Amélioration en cours"}</span></div>
   </header>
   <section className="pa-maintenance-layout">
    <div className="pa-maintenance-copy">
     <div className="pa-maintenance-kicker"><span>✦</span> Petit Annonces évolue</div>
     <h1>On prépare quelque chose de <em>plus fluide.</em></h1>
     <p>Nous améliorons Petit Annonces pour rendre vos recherches, vos annonces et vos échanges encore plus simples, rapides et agréables.</p>
     <div className="pa-maintenance-points"><span><b>01</b> Navigation optimisée</span><span><b>02</b> Expérience plus rapide</span><span><b>03</b> Services renforcés</span></div>
     <div className="pa-maintenance-return"><div className="pa-maintenance-pulse"><i/><i/><i/></div><div><strong>Nous revenons très bientôt</strong><small>Merci pour votre patience et votre confiance.</small></div></div>
    </div>
    <MaintenanceMap/>
   </section>
   <footer className="pa-maintenance-footer"><span>© {new Date().getFullYear()} {site.siteName}</span><span>Petites annonces partout en France</span></footer>
  </div>
 </main>;
}
