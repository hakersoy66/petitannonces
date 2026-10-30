"use client";
import {useEffect,useState} from "react";
import styles from "./black-friday-banner.module.css";
type Campaign={visible:boolean;active:boolean;edition:number;startsAt:string;endsAt:string};
const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
export function BlackFridayBanner(){
  const[c,setC]=useState<Campaign|null>(null);
  useEffect(()=>{
    let live=true;
    fetch(api()+"/public/campaigns/black-friday",{cache:"no-store"})
      .then(r=>r.ok?r.json():null)
      .then(p=>{if(live&&p)setC(p as Campaign)})
      .catch(()=>{});
    return()=>{live=false};
  },[]);
  if(!c?.visible)return null;
  const day=(d:Date)=>new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",day:"numeric",month:"long"}).format(d);
  const period=day(new Date(c.startsAt))+" – "+day(new Date(Date.parse(c.endsAt)-1));
  return <section className={styles.band} style={{order:7}} aria-label={"Black Friday "+c.edition}>
    <div className={styles.inner}>
      <div className={styles.emblem}><span>BLACK</span><strong>FRIDAY</strong><small>{c.edition}</small></div>
      <div className={styles.copy}>
        <span className={styles.kicker}>{c.active?period.toUpperCase():"ÇA SE PRÉPARE · "+period.toUpperCase()}</span>
        <h2>{c.active?"Le rendez-vous des bonnes affaires.":"Le Black Friday arrive sur Petit Annonces."}</h2>
        <p>{c.active?"Explorez les annonces sélectionnées par les vendeurs.":"Vendeurs : préparez vos annonces pour la sélection spéciale."}</p>
      </div>
      <a href="/black-friday">{c.active?"Voir la sélection":"Découvrir l’événement"} <span aria-hidden="true">→</span></a>
    </div>
  </section>;
}
