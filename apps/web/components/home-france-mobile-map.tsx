type City={name:string;x:number;y:number;tx:number;ty:number;featured?:boolean};
function citySlug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
const cities:City[]=[
  {name:"Lille",x:1017,y:291,tx:1048,ty:270},{name:"Paris",x:938,y:589,tx:970,ty:572,featured:true},
  {name:"Rennes",x:485,y:710,tx:360,ty:692},{name:"Nantes",x:499,y:855,tx:365,ty:875},
  {name:"Bordeaux",x:609,y:1228,tx:455,ty:1260},{name:"Toulouse",x:836,y:1415,tx:690,ty:1455},
  {name:"Lyon",x:1216,y:1085,tx:1250,ty:1123,featured:true},{name:"Marseille",x:1276,y:1461,tx:1315,ty:1510},
  {name:"Nice",x:1489,y:1399,tx:1522,ty:1428},{name:"Strasbourg",x:1544,y:636,tx:1580,ty:620},
];

export function HomeFranceMobileMap({logoUrl}:{logoUrl?:string|null}){
 return <section className="mobile-legacy-home mobile-france-map-preview" aria-label="Carte des annonces en France">
  <div className="mobile-france-map-card">
   <div className="pa-france-map-stage">
    <div className="pa-map-glow" aria-hidden="true"/>
    <div className="pa-map-disc" aria-hidden="true"/>
    <span className="pa-map-pointer" aria-hidden="true"><svg viewBox="0 0 48 58" focusable="false"><path d="M20 3c3 0 5 2 5 5v17l3-4c2-2 5-2 7 0l7 7c2 2 3 5 2 8l-3 10c-1 5-6 9-11 9H19c-4 0-8-2-10-6L3 37c-1-3 0-6 3-7 2-1 5 0 6 2l3 5V8c0-3 2-5 5-5Z"/><path d="M15 26V8c0-3 2-5 5-5s5 2 5 5v17" className="pa-map-pointer-line"/></svg></span>
    <div className="pa-france-map-stack">
     <img className="pa-france-map-image" src="/france-hero-map.svg" alt="Carte de la France métropolitaine" width="1796" height="1797" loading="lazy" decoding="async" />
     <svg className="pa-france-map" viewBox="0 0 1796 1797" role="img" aria-label="Villes disponibles sur Petit Annonces">
      <g className="pa-route-lines" fill="none"><path d="M938 589 C1040 660 1165 860 1216 1085"/><path d="M1216 1085 C1270 1188 1300 1335 1276 1461"/><path d="M609 1228 C625 970 745 730 938 589"/><path d="M836 1415 C965 1335 1090 1215 1216 1085"/></g>
      <g className="pa-route-motion pa-package-a"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="6.4s" repeatCount="indefinite" path="M938 589 C1040 660 1165 860 1216 1085"/></g>
      <g className="pa-route-motion pa-money-a"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="6.4s" begin="-3.1s" repeatCount="indefinite" path="M1216 1085 C1165 860 1040 660 938 589"/></g>
      <g className="pa-route-motion pa-package-b"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="7s" begin="-1.6s" repeatCount="indefinite" path="M1216 1085 C1270 1188 1300 1335 1276 1461"/></g>
      <g className="pa-route-motion pa-money-b"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="7s" begin="-4.7s" repeatCount="indefinite" path="M1276 1461 C1300 1335 1270 1188 1216 1085"/></g>
      {cities.map(city=><a key={city.name} href={`/ville/${citySlug(city.name)}`} aria-label={`Voir les annonces à ${city.name}`} className={`pa-city-link${city.featured?" is-featured":""}`}><circle className="pa-city-ring" cx={city.x} cy={city.y} r={city.featured?34:25}/><circle className="pa-city-dot" cx={city.x} cy={city.y} r={city.featured?15:10}/><text className="pa-city-label" x={city.tx} y={city.ty}>{city.name}</text></a>)}
     </svg>
     <img className="pa-mobile-map-brand-logo" src={logoUrl??"/pwa-loading-logo.svg"} alt="Petit Annonces" loading="lazy" decoding="async" />
    </div>
   </div>
  </div>
 </section>;
}