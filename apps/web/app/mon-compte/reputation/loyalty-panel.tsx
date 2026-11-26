"use client";
import {useEffect,useState} from "react";
import styles from "./page.module.css";
type Data={points:number;level:string;history:{id:string;kind:string;delta:number;balanceAfter:number;createdAt:string}[]};
const levels:Record<string,string>={START:"Découverte",BRONZE:"Bronze",SILVER:"Argent",GOLD:"Or"};
export default function LoyaltyPanel(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(false);
 useEffect(()=>{const c=new AbortController();fetch((process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"")+"/account/loyalty",{credentials:"include",cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const x=await r.json();if(!c.signal.aborted)setData(x)}).catch(()=>{if(!c.signal.aborted)setError(true)});return()=>c.abort()},[]);
 return <section className={styles.earnedPanel}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Fidélité</span><h2>Vos points de fidélité</h2><p>Les points sont distincts du crédit en euros et de l’indice de confiance.</p></div></div>{error?<p>Solde indisponible.</p>:data?<><h3>{data.points.toLocaleString("fr-FR")} points · {levels[data.level]}</h3><p>Bronze dès 100 points, Argent dès 500, Or dès 1 000. Les niveaux dépendent du solde actuel.</p><p>Une prolongation de 7 jours pour 100 points est possible sur une annonce éligible, après validation de l’administration. Aucun échange en argent.</p>{data.history.length>0&&<details><summary>20 dernières opérations</summary>{data.history.map(h=><p key={h.id}>{new Date(h.createdAt).toLocaleDateString("fr-FR")} · {h.kind==="EXTENSION_REWARD"?"Prolongation":"Ajustement"} · {h.delta>0?"+":""}{h.delta} points · Solde {h.balanceAfter}</p>)}</details>}</>:<p>Chargement…</p>}</section>
}
