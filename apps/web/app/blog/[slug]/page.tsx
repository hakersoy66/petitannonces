import type {Metadata} from "next";
import {notFound} from "next/navigation";

export const revalidate=86400;

type Guide={title:string;description:string;eyebrow:string;intro:string;sections:Array<{title:string;body:string;bullets?:string[]}>;links:Array<{href:string;label:string}>;faq:Array<{q:string;a:string}>};
const GUIDES:Record<string,Guide>={
 "vendre-objet-occasion":{
  title:"Comment vendre un objet d’occasion en ligne ?",
  description:"Checklist pratique pour vendre un objet d’occasion : prix, photos, description, remise, sécurité et publication de l’annonce.",
  eyebrow:"Vendre d’occasion",
  intro:"Vendre d’occasion ne consiste pas seulement à publier une photo et un prix. Une annonce claire, documentée et réaliste réduit les questions inutiles et aide l’acheteur à décider plus vite.",
  sections:[
   {title:"1. Identifier précisément ce que vous vendez",body:"Notez la marque, le modèle, l’état, les dimensions, la date d’achat approximative et les accessoires inclus. Pour un appareil, précisez aussi ce qui fonctionne ou non.",bullets:["Nom exact du produit","État réel et défauts visibles","Accessoires, facture ou emballage si disponibles","Mode de remise ou d’expédition"]},
   {title:"2. Fixer un prix cohérent",body:"Comparez plusieurs annonces réellement proches de votre objet. Un prix trop élevé ralentit les contacts; un prix anormalement bas peut au contraire susciter de la méfiance."},
   {title:"3. Prendre des photos utiles",body:"Utilisez une lumière naturelle, un fond simple et plusieurs angles. Photographiez aussi les défauts : la transparence évite les mauvaises surprises."},
   {title:"4. Rédiger une annonce facile à comprendre",body:"Commencez par l’information principale, puis décrivez l’état, les caractéristiques et les conditions de remise. Évitez les titres vagues et les superlatifs inutiles."},
   {title:"5. Préparer l’échange",body:"Gardez les échanges sur la plateforme lorsque c’est possible, vérifiez les informations importantes avant la remise et ne communiquez pas de données sensibles sans nécessité."}
  ],
  links:[{href:"/deposer-annonce-gratuite",label:"Déposer une annonce gratuite"},{href:"/blog/rediger-annonce-efficace",label:"Rédiger une annonce efficace"},{href:"/blog/acheter-occasion-securite",label:"Conseils de sécurité"}],
  faq:[{q:"Faut-il mettre un prix négociable ?",a:"Vous pouvez le préciser, mais un prix de départ cohérent reste préférable pour attirer des contacts sérieux."},{q:"Combien de photos faut-il ajouter ?",a:"Ajoutez suffisamment de photos pour montrer l’objet, ses détails et ses éventuels défauts. La qualité compte davantage qu’un nombre fixe."}]
 },
 "vendre-entre-particuliers":{
  title:"Vendre entre particuliers : la checklist avant de publier",
  description:"Les étapes à vérifier avant une vente entre particuliers : annonce, prix, contact, remise, paiement et sécurité.",
  eyebrow:"Entre particuliers",
  intro:"Une vente entre particuliers fonctionne mieux lorsque les informations essentielles sont préparées avant le premier message. Cette checklist vous aide à structurer la vente sans compliquer l’échange.",
  sections:[
   {title:"Préparer les informations",body:"Rassemblez les caractéristiques utiles, l’état, les éventuels défauts, les accessoires et les modalités de remise avant de publier."},
   {title:"Choisir le bon prix",body:"Appuyez-vous sur des annonces comparables et sur l’état réel de votre bien. Conservez une marge de négociation uniquement si elle correspond à votre stratégie de vente."},
   {title:"Filtrer les demandes",body:"Privilégiez les échanges cohérents avec l’annonce. Méfiez-vous des demandes pressantes, des changements de canal inhabituels ou des propositions qui ne correspondent pas au bien."},
   {title:"Organiser la remise",body:"Pour une remise en main propre, choisissez un lieu approprié et vérifiez l’objet avec l’acheteur. Pour une expédition, utilisez les modalités prévues par la plateforme lorsqu’elles sont disponibles."},
   {title:"Conserver une trace utile",body:"Gardez les échanges importants et les éléments relatifs à la transaction jusqu’à sa bonne conclusion."}
  ],
  links:[{href:"/categorie/maison-jardin",label:"Maison & jardin"},{href:"/categorie/high-tech",label:"High-tech d’occasion"},{href:"/observatoire",label:"Observatoire des annonces"}],
  faq:[{q:"Peut-on vendre gratuitement entre particuliers ?",a:"Oui, les particuliers peuvent déposer gratuitement une annonce sur Petit Annonces, sous réserve des règles de publication."},{q:"Que faut-il éviter dans une annonce ?",a:"Évitez les informations trompeuses, les descriptions trop vagues et toute donnée personnelle inutile."}]
 },
 "rediger-annonce-efficace":{
  title:"Comment rédiger une annonce efficace qui attire les bons acheteurs ?",
  description:"Titre, description, photos, prix et localisation : méthode simple pour rédiger une petite annonce claire et utile.",
  eyebrow:"Rédaction",
  intro:"Une bonne annonce répond aux principales questions de l’acheteur avant même le premier message. Elle doit être précise, lisible et fidèle à la réalité.",
  sections:[
   {title:"Un titre qui décrit immédiatement le bien",body:"Utilisez le type d’objet, la marque ou le modèle lorsqu’ils sont utiles. Le titre doit rester lisible et éviter les mots génériques comme « superbe » ou « affaire »."},
   {title:"Une description structurée",body:"Présentez d’abord l’état et les caractéristiques principales, puis les détails, accessoires, défauts et modalités de remise.",bullets:["État","Dimensions ou caractéristiques","Ce qui est inclus","Défauts connus","Remise ou livraison"]},
   {title:"Des photos cohérentes avec le texte",body:"La photo principale doit montrer clairement l’objet. Les photos suivantes servent à confirmer les détails décrits."},
   {title:"Une localisation assez précise",body:"La ville aide l’acheteur à savoir si la remise est réaliste et permet aux pages locales de présenter les annonces pertinentes."},
   {title:"Relire avant publication",body:"Vérifiez les chiffres, le modèle, le prix et les fautes qui pourraient modifier le sens d’une information."}
  ],
  links:[{href:"/deposer-annonce-gratuite",label:"Publier gratuitement"},{href:"/blog/vendre-objet-occasion",label:"Vendre un objet d’occasion"},{href:"/professionnels",label:"Solutions pour professionnels"}],
  faq:[{q:"Quelle longueur pour une description ?",a:"Il n’existe pas de longueur idéale. Elle doit surtout répondre clairement aux questions essentielles sur l’objet, son état et la remise."},{q:"Faut-il utiliser beaucoup de mots-clés ?",a:"Non. Écrivez d’abord pour l’acheteur. Une description naturelle et précise est préférable à une répétition artificielle de mots-clés."}]
 },
 "acheter-occasion-securite":{
  title:"Acheter d’occasion en ligne : les vérifications essentielles",
  description:"Guide pratique pour acheter un objet d’occasion : état, prix, vendeur, paiement, remise et signaux d’alerte.",
  eyebrow:"Acheter d’occasion",
  intro:"Acheter d’occasion peut être simple à condition de vérifier quelques éléments avant de payer ou de se déplacer. L’objectif est de confirmer que le bien correspond réellement à l’annonce.",
  sections:[
   {title:"Comparer le prix",body:"Regardez plusieurs annonces comparables. Un écart important mérite une explication claire sur l’état, les accessoires ou les conditions de vente."},
   {title:"Lire toute l’annonce",body:"Vérifiez la description, les photos, la localisation et les éventuels défauts. Posez une question lorsqu’une information importante manque."},
   {title:"Observer la cohérence de l’échange",body:"Un vendeur doit pouvoir répondre à des questions raisonnables sur le bien. Les demandes de paiement inhabituelles ou la pression pour agir très vite sont des signaux à examiner."},
   {title:"Vérifier lors de la remise",body:"Pour un objet technique, testez les fonctions importantes lorsque c’est possible. Contrôlez aussi la correspondance entre l’objet remis et l’annonce."},
   {title:"Protéger ses informations",body:"Ne transmettez que les informations réellement nécessaires à la transaction et utilisez les outils de la plateforme lorsque disponibles."}
  ],
  links:[{href:"/conformite",label:"Sécurité & conformité"},{href:"/categorie/high-tech",label:"High-tech d’occasion"},{href:"/categorie/collection",label:"Objets de collection"}],
  faq:[{q:"Un prix très bas est-il toujours une arnaque ?",a:"Pas nécessairement, mais un prix très éloigné des offres comparables justifie des vérifications supplémentaires."},{q:"Que vérifier pour un appareil électronique ?",a:"Le modèle exact, l’état général, les fonctions principales, les accessoires, le verrouillage éventuel et l’autonomie lorsqu’elle est pertinente."}]
 },
 "rediger-annonce-immobiliere":{
  title:"Comment rédiger une annonce immobilière entre particuliers ?",
  description:"Guide pour structurer une annonce immobilière claire : type de bien, surface, localisation, prix, équipements, photos et informations utiles.",
  eyebrow:"Immobilier",
  intro:"Une annonce immobilière doit permettre au lecteur de comprendre rapidement le type de bien, sa localisation, ses caractéristiques et ses principales conditions avant d’organiser une visite.",
  sections:[
   {title:"Présenter les caractéristiques essentielles",body:"Indiquez le type de bien, la surface, le nombre de pièces, la localisation, le prix ou le loyer et les caractéristiques qui influencent réellement la décision."},
   {title:"Décrire les points forts sans masquer les contraintes",body:"Balcon, jardin, stationnement ou luminosité peuvent être mis en avant, mais les informations importantes comme l’étage ou certaines contraintes doivent rester claires."},
   {title:"Soigner les photos",body:"Présentez les pièces principales avec une lumière correcte et un cadrage lisible. Évitez les images qui donnent une perception trompeuse des volumes."},
   {title:"Ajouter les informations réglementaires applicables",body:"Les obligations varient selon la nature de l’opération et votre situation. Vérifiez les mentions et diagnostics requis au moment de la publication."},
   {title:"Faciliter la recherche locale",body:"Une ville et une catégorie exactes améliorent la pertinence des résultats pour les personnes qui recherchent dans la zone concernée."}
  ],
  links:[{href:"/categorie/immobilier",label:"Annonces immobilières"},{href:"/observatoire",label:"Voir les villes actives"},{href:"/deposer-annonce-gratuite",label:"Déposer une annonce"}],
  faq:[{q:"Doit-on indiquer la surface dans l’annonce ?",a:"La surface fait partie des informations essentielles d’une annonce immobilière et certaines mentions peuvent être obligatoires selon le type de transaction."},{q:"Peut-on publier une annonce immobilière entre particuliers ?",a:"Oui, sous réserve de respecter les règles de publication et les obligations applicables au bien et à la transaction."}]
 },
 "acheter-smartphone-occasion":{
  title:"Acheter un smartphone d’occasion : quoi vérifier avant de payer ?",
  description:"Batterie, écran, compte utilisateur, réseau, IMEI, accessoires et prix : checklist avant l’achat d’un smartphone d’occasion.",
  eyebrow:"High-tech",
  intro:"Un smartphone d’occasion peut être une bonne affaire si son état, son fonctionnement et sa situation sont vérifiés avant le paiement.",
  sections:[
   {title:"Confirmer le modèle exact",body:"Vérifiez la référence, la capacité de stockage, la couleur et les caractéristiques annoncées. Deux versions visuellement proches peuvent avoir une valeur différente."},
   {title:"Tester l’écran, les boutons et les caméras",body:"Contrôlez le tactile, la luminosité, les boutons, les haut-parleurs, le microphone et les caméras lorsque la remise se fait en main propre."},
   {title:"Examiner la batterie",body:"Demandez l’état de santé de la batterie lorsque le système le permet. Une batterie très usée doit être prise en compte dans le prix."},
   {title:"Vérifier le verrouillage et les comptes",body:"Le téléphone doit pouvoir être dissocié du compte de son ancien propriétaire avant la remise. Vérifiez également qu’il peut se connecter normalement au réseau."},
   {title:"Comparer le prix aux offres similaires",body:"Comparez modèle, stockage, état et accessoires. Un prix n’a de sens qu’en comparaison avec des appareils équivalents."}
  ],
  links:[{href:"/categorie/telephones-smartphones",label:"Téléphones & smartphones"},{href:"/blog/acheter-occasion-securite",label:"Acheter d’occasion en sécurité"},{href:"/observatoire",label:"Tendances des catégories"}],
  faq:[{q:"Que faut-il vérifier en priorité sur un smartphone ?",a:"Le modèle, l’écran, les fonctions principales, la batterie, l’absence de verrouillage de compte et la cohérence du prix."},{q:"Faut-il demander l’IMEI ?",a:"L’IMEI peut aider à identifier l’appareil. Ne publiez toutefois pas de données sensibles inutilement dans une annonce publique."}]
 }
};

function safe(value:unknown){return JSON.stringify(value).replace(/</g,"\\u003c")}
export function generateStaticParams(){return Object.keys(GUIDES).map(slug=>({slug}))}
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const{slug}=await params;const g=GUIDES[slug];if(!g)return{robots:{index:false,follow:true}};return{title:{absolute:`${g.title} | Petit Annonces`},description:g.description,alternates:{canonical:`/blog/${slug}`},openGraph:{type:"article",url:`/blog/${slug}`,title:g.title,description:g.description}}}
export default async function GuidePage({params}:{params:Promise<{slug:string}>}){const{slug}=await params;const g=GUIDES[slug];if(!g)notFound();const faq={"@context":"https://schema.org","@type":"FAQPage",mainEntity:g.faq.map(x=>({"@type":"Question",name:x.q,acceptedAnswer:{"@type":"Answer",text:x.a}}))};const article={"@context":"https://schema.org","@type":"Article",headline:g.title,description:g.description,author:{"@type":"Organization",name:"Petit Annonces"},publisher:{"@type":"Organization",name:"Petit Annonces"},mainEntityOfPage:`https://petitannonces.fr/blog/${slug}`};
 return <div style={{minHeight:"100vh",background:"#f7f7fb",color:"#222331"}}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:safe(article)}}/><script type="application/ld+json" dangerouslySetInnerHTML={{__html:safe(faq)}}/><main style={{width:"min(930px,calc(100% - 24px))",margin:"0 auto",padding:"30px 0 76px"}}><nav style={{fontSize:13,color:"#777887",marginBottom:14}}><a href="/" style={{color:"#5b4cf0"}}>Accueil</a> › <a href="/blog" style={{color:"#5b4cf0"}}>Guides</a> › {g.eyebrow}</nav><header style={{padding:"clamp(28px,5vw,48px)",borderRadius:26,background:"linear-gradient(135deg,#171625,#322c70 58%,#5b4cf0)",color:"#fff"}}><small style={{fontWeight:950,letterSpacing:1.1,textTransform:"uppercase",opacity:.78}}>{g.eyebrow}</small><h1 style={{margin:"10px 0 14px",fontSize:"clamp(34px,5vw,54px)",lineHeight:1.02,letterSpacing:"-.045em"}}>{g.title}</h1><p style={{margin:0,maxWidth:780,fontSize:17,lineHeight:1.72,opacity:.9}}>{g.intro}</p></header><article style={{marginTop:18,padding:"clamp(22px,4vw,38px)",background:"#fff",border:"1px solid #e5e4ed",borderRadius:22}}>{g.sections.map(s=><section key={s.title} style={{marginBottom:30}}><h2 style={{margin:"0 0 9px",fontSize:25,letterSpacing:"-.025em"}}>{s.title}</h2><p style={{margin:0,color:"#5f606d",lineHeight:1.76}}>{s.body}</p>{s.bullets&&<ul style={{margin:"12px 0 0",paddingLeft:22,color:"#5f606d",lineHeight:1.75}}>{s.bullets.map(b=><li key={b}>{b}</li>)}</ul>}</section>)}<section style={{padding:20,borderRadius:16,background:"#f4f2ff"}}><strong>À explorer sur Petit Annonces</strong><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:11}}>{g.links.map(l=><a key={l.href} href={l.href} style={{padding:"9px 12px",borderRadius:999,background:"#fff",border:"1px solid #ddd8ff",color:"#5143d7",textDecoration:"none",fontWeight:850,fontSize:12}}>{l.label}</a>)}</div></section></article><section style={{marginTop:18,padding:24,background:"#fff",border:"1px solid #e5e4ed",borderRadius:22}}><small style={{color:"#5b4cf0",fontWeight:950}}>QUESTIONS FRÉQUENTES</small><h2 style={{margin:"6px 0 12px"}}>Questions utiles</h2><div style={{display:"grid",gap:10}}>{g.faq.map(x=><details key={x.q} style={{padding:"13px 14px",border:"1px solid #ececf2",borderRadius:14}}><summary style={{cursor:"pointer",fontWeight:850}}>{x.q}</summary><p style={{margin:"9px 0 0",color:"#626371",lineHeight:1.65}}>{x.a}</p></details>)}</div></section></main></div>
}