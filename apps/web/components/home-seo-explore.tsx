"use client";

import {useState} from "react";

type SeoCity={city:string;slug:string};
const links=[
 {href:"/categorie/vehicules",label:"Voitures et véhicules d’occasion"},
 {href:"/categorie/emploi",label:"Offres d’emploi en France"},
 {href:"/categorie/immobilier",label:"Immobilier"},
 {href:"/categorie/high-tech",label:"High-tech"},
 {href:"/categorie/maison-jardin",label:"Maison & jardin"},
 {href:"/categorie/collection",label:"Collection"},
 {href:"/categorie/services",label:"Services"},
 {href:"/categorie/decoration",label:"Décoration"},
 {href:"/categorie/chats",label:"Chats"},
 {href:"/categorie/aspirateurs",label:"Aspirateurs"},
 {href:"/vacances",label:"Locations de vacances"},
 {href:"/professionnels",label:"Boutiques professionnelles"}
] as const;

/** All SEO navigation links remain in the HTML for discovery, even when
 * the optional mobile disclosure is collapsed. */
export function HomeSeoExplore({cities}:{cities:SeoCity[]}){
 const [expanded,setExpanded]=useState(false);
 return <div className="home-seo-hub-explore">
  <button
   type="button"
   className="home-seo-hub-toggle"
   aria-expanded={expanded}
   aria-controls="home-seo-hub-navigation"
   onClick={()=>setExpanded(value=>!value)}
  >
   <span className="home-seo-hub-toggle-icon" aria-hidden="true">⌕</span>
   <span className="home-seo-hub-toggle-copy"><strong>Explorer par catégorie et par ville</strong><small>Véhicules, immobilier, services et annonces locales</small></span>
   <span className="home-seo-hub-toggle-arrow" aria-hidden="true">{expanded?"−":"+"}</span>
  </button>
  <div id="home-seo-hub-navigation" className={"home-seo-hub-navigation"+(expanded?" is-expanded":"")}>
   <nav className="home-seo-hub-card" aria-label="Catégories populaires">
    <div className="home-seo-hub-card-head"><span className="home-seo-hub-card-symbol" aria-hidden="true">▦</span><div><h3>Explorer les catégories</h3><p>Parcourez les annonces par univers</p></div></div>
    <div className="home-seo-hub-link-grid">{links.map(link=><a key={link.href} href={link.href}>{link.label}<span aria-hidden="true">↗</span></a>)}</div>
   </nav>
   {cities.length>0&&<nav className="home-seo-hub-card" aria-label="Villes populaires">
    <div className="home-seo-hub-card-head"><span className="home-seo-hub-card-symbol city" aria-hidden="true">⌖</span><div><h3>Près de chez vous</h3><p>Découvrez les petites annonces locales</p></div></div>
    <div className="home-seo-hub-link-grid city">{cities.map(city=><a key={city.slug} href={"/ville/"+city.slug}>{city.city}<span aria-hidden="true">↗</span></a>)}</div>
   </nav>}
  </div>
 </div>;
}
