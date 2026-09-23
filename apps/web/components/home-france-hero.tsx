import { AppIcon } from "./app-icon";

type City={name:string;x:number;y:number;tx:number;ty:number;featured?:boolean};

function citySlug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

const cities:City[]=[
  {name:"Lille",x:1017,y:291,tx:1048,ty:270},
  {name:"Paris",x:938,y:589,tx:970,ty:572,featured:true},
  {name:"Rennes",x:485,y:710,tx:360,ty:692},
  {name:"Nantes",x:499,y:855,tx:365,ty:875},
  {name:"Bordeaux",x:609,y:1228,tx:455,ty:1260},
  {name:"Toulouse",x:836,y:1415,tx:690,ty:1455},
  {name:"Lyon",x:1216,y:1085,tx:1250,ty:1123,featured:true},
  {name:"Marseille",x:1276,y:1461,tx:1315,ty:1510},
  {name:"Nice",x:1489,y:1399,tx:1522,ty:1428},
  {name:"Strasbourg",x:1544,y:636,tx:1580,ty:620},
];

function ParisSilhouette(){
  return <svg className="pa-paris-silhouette" viewBox="0 0 1500 300" aria-hidden="true" focusable="false">
    <g className="pa-paris-skyline">
      <path className="pa-skyline-buildings" d="M0 275H70V244H94V211H116V275H151V233H179V191H195V275H226V247H254V223H275V275H319V238H342V197H365V275H406V249H427V217H448V275H494V235H519V203H543V275H584V249H610V226H635V275H678V243H701V215H724V275H770V236H792V201H814V275H859V246H884V220H909V275H951V239H974V207H998V275H1039V248H1061V222H1082V275H1125V237H1149V198H1174V275H1211V244H1233V218H1255V275H1293V238H1316V203H1339V275H1381V246H1406V218H1431V275H1500V300H0Z"/>
      <path className="pa-eiffel" d="M420 275H468L520 97H538L550 62H566L578 16H592L604 62H620L632 97H650L702 275H750L700 275L636 119H514L450 275ZM557 81H613L585 31ZM533 143H637L622 180H548ZM510 205H660L646 236H524Z"/>
      <path className="pa-dome" d="M806 275V219H821V197H834V181H848V165H862V181H875V197H889V219H904V275Z"/>
      <path className="pa-bridge" d="M952 276H1248V259H1230C1217 232 1194 222 1170 222C1146 222 1123 232 1110 259H1068C1055 232 1032 222 1008 222C984 222 961 232 948 259H952Z"/>
    </g>
  </svg>;
}

export function HomeFranceHero(){
  return <section className="pa-france-hero" aria-labelledby="pa-france-hero-title">
    <ParisSilhouette/>
    <div className="pa-france-cloud pa-france-cloud-a" aria-hidden="true"/>
    <div className="pa-france-cloud pa-france-cloud-b" aria-hidden="true"/>

    <div className="shell pa-france-hero-layout">
      <div className="pa-france-hero-copy">
        <h1 id="pa-france-hero-title"><span className="pa-hero-title-line pa-hero-title-dark">Petites annonces</span><span className="pa-hero-title-line pa-hero-title-accent">gratuites partout</span><span className="pa-hero-title-line pa-hero-title-dark pa-hero-title-nowrap">en France</span></h1>
        <div className="pa-france-benefits">
          <div className="pa-france-benefit"><span className="pa-france-benefit-icon"><AppIcon name="shield"/></span><div><strong>Paiement sécurisé</strong><small>Vos transactions sont protégées du début à la fin.</small></div></div>
          <div className="pa-france-benefit"><span className="pa-france-benefit-icon"><AppIcon name="store"/></span><div><strong>Ouvrez votre boutique</strong><small>Développez votre activité et touchez davantage d’acheteurs.</small></div></div>
          <div className="pa-france-benefit"><span className="pa-france-benefit-icon"><AppIcon name="plus"/></span><div><strong>Déposer une annonce</strong><small>Publication gratuite et facile, en quelques clics.</small></div></div>
        </div>

        <div className="pa-france-handnote">Ensemble, plus proche<br/>des Français&nbsp;!<i aria-hidden="true"/></div>
      </div>

      <div className="pa-france-map-stage" aria-label="Carte interactive de la France">
        <div className="pa-map-glow" aria-hidden="true"/>
        <div className="pa-map-disc" aria-hidden="true"/>
        <div className="pa-map-handnote" aria-hidden="true">Des annonces<br/>près de vous&nbsp;!<i/></div>

        <div className="pa-map-callout pa-callout-parcel"><span className="pa-callout-icon"><AppIcon name="box"/></span><div><strong>Colis en livraison</strong><small>De Paris à Lyon</small></div><span className="pa-callout-arrow">›</span></div>
        <div className="pa-map-callout pa-callout-payment"><span className="pa-callout-icon pa-callout-euro">€</span><div><strong>Paiement confirmé</strong><small>Lyon</small></div><span className="pa-callout-arrow">›</span></div>
        <div className="pa-map-callout pa-callout-click"><span className="pa-callout-pin"><AppIcon name="location"/></span><strong>Cliquez sur une ville</strong></div>
        <div className="pa-map-callout pa-callout-near"><span className="pa-callout-icon"><AppIcon name="truck"/></span><div><strong>Une livraison plus proche</strong><small>Partout en France</small></div><span className="pa-callout-arrow">›</span></div>

        <span className="pa-map-pointer" aria-hidden="true">
          <svg viewBox="0 0 48 58" focusable="false"><path d="M20 3c3 0 5 2 5 5v17l3-4c2-2 5-2 7 0l7 7c2 2 3 5 2 8l-3 10c-1 5-6 9-11 9H19c-4 0-8-2-10-6L3 37c-1-3 0-6 3-7 2-1 5 0 6 2l3 5V8c0-3 2-5 5-5Z"/><path d="M15 26V8c0-3 2-5 5-5s5 2 5 5v17" className="pa-map-pointer-line"/></svg>
        </span>

        <div className="pa-france-map-stack">
          <img className="pa-france-map-image" src="/france-hero-map.svg" alt="Carte de la France métropolitaine" width="1796" height="1797" fetchPriority="high" decoding="async" />
          <svg className="pa-france-map" viewBox="0 0 1796 1797" role="img" aria-labelledby="pa-map-title pa-map-desc">
          <title id="pa-map-title">Carte réelle de la France métropolitaine</title>
          <desc id="pa-map-desc">Cliquez sur une ville pour voir toutes les annonces de cette ville.</desc>

          <g className="pa-route-lines" fill="none">
            <path d="M938 589 C1040 660 1165 860 1216 1085"/>
            <path d="M1216 1085 C1270 1188 1300 1335 1276 1461"/>
            <path d="M609 1228 C625 970 745 730 938 589"/>
            <path d="M836 1415 C965 1335 1090 1215 1216 1085"/>
          </g>

          <g className="pa-route-logo" transform="translate(1010 895)" aria-label="Petit Annonces"><image href="/pwa-loading-logo.svg" x="-78" y="-44" width="156" height="88" preserveAspectRatio="xMidYMid meet"/></g>

          <g className="pa-route-motion pa-package-a"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="6.4s" repeatCount="indefinite" path="M938 589 C1040 660 1165 860 1216 1085"/></g>
          <g className="pa-route-motion pa-money-a"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="6.4s" begin="-3.1s" repeatCount="indefinite" path="M1216 1085 C1165 860 1040 660 938 589"/></g>
          <g className="pa-route-motion pa-package-b"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="7s" begin="-1.6s" repeatCount="indefinite" path="M1216 1085 C1270 1188 1300 1335 1276 1461"/></g>
          <g className="pa-route-motion pa-money-b"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="7s" begin="-4.7s" repeatCount="indefinite" path="M1276 1461 C1300 1335 1270 1188 1216 1085"/></g>
          <g className="pa-route-motion pa-package-c"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="7.5s" begin="-2s" repeatCount="indefinite" path="M609 1228 C625 970 745 730 938 589"/></g>
          <g className="pa-route-motion pa-money-c"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="7.5s" begin="-5.5s" repeatCount="indefinite" path="M938 589 C745 730 625 970 609 1228"/></g>
          <g className="pa-route-motion pa-package-d"><rect x="-31" y="-31" width="62" height="62" rx="12"/><path d="M-31 -4 H31 M0 -31 V31"/><animateMotion dur="6.8s" begin="-2.5s" repeatCount="indefinite" path="M836 1415 C965 1335 1090 1215 1216 1085"/></g>
          <g className="pa-route-motion pa-money-d"><circle r="31"/><text x="0" y="11">€</text><animateMotion dur="6.8s" begin="-5.8s" repeatCount="indefinite" path="M1216 1085 C1090 1215 965 1335 836 1415"/></g>

          {cities.map(city=><a key={city.name} href={`/ville/${citySlug(city.name)}`} aria-label={`Voir toutes les annonces à ${city.name}`} className={`pa-city-link${city.featured?" is-featured":""}`}>
            <circle className="pa-city-ring" cx={city.x} cy={city.y} r={city.featured?34:25}/>
            <circle className="pa-city-dot" cx={city.x} cy={city.y} r={city.featured?15:10}/>
            <text className="pa-city-label" x={city.tx} y={city.ty}>{city.name}</text>
          </a>)}
          </svg>
        </div>
      </div>
    </div>
  </section>;
}
