import type {Metadata} from "next";

export const revalidate=300;

export const metadata:Metadata={
 title:{absolute:"Presse & médias | Petit Annonces"},
 description:"Espace presse de Petit Annonces : présentation de la plateforme française de petites annonces, informations utiles, liens et contact média.",
 alternates:{canonical:"https://petitannonces.fr/presse"},
 openGraph:{type:"website",url:"https://petitannonces.fr/presse",title:"Presse & médias | Petit Annonces",description:"Informations presse, présentation et ressources utiles sur Petit Annonces."}
};

type Site={siteName?:string;logoUrl?:string|null;footerLogoUrl?:string|null};
const api=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
async function site():Promise<Site>{try{const r=await fetch(`${api()}/public/site-config`,{next:{revalidate:300}});if(!r.ok)return{};const d=await r.json() as{site?:Site};return d.site??{}}catch{return{}}}
function safe(value:unknown){return JSON.stringify(value).replace(/</g,"\\u003c")}

export default async function PressePage(){
 const s=await site();
 const name=s.siteName??"Petit Annonces";
 const logo=s.footerLogoUrl??s.logoUrl??null;
 const org={"@context":"https://schema.org","@type":"Organization",name,url:"https://petitannonces.fr",logo:logo??"https://petitannonces.fr/icons/icon-512.png",description:"Plateforme française de petites annonces pour particuliers et professionnels."};
 return <div style={{minHeight:"100vh",background:"#f7f7fb"}}>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safe(org)}}/>
  <main style={{width:"min(1120px,calc(100% - 24px))",margin:"0 auto",padding:"42px 0 72px"}}>
   <section style={{padding:"clamp(28px,5vw,54px)",borderRadius:28,background:"linear-gradient(135deg,#171725,#403796)",color:"#fff",boxShadow:"0 24px 70px rgba(41,34,92,.16)"}}>
    <span style={{display:"inline-flex",padding:"7px 11px",border:"1px solid rgba(255,255,255,.2)",borderRadius:999,fontSize:11,fontWeight:900,letterSpacing:".08em",textTransform:"uppercase"}}>Presse & médias</span>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:28,alignItems:"center",marginTop:18}}>
     <div><h1 style={{margin:0,fontSize:"clamp(38px,6vw,66px)",lineHeight:.98,letterSpacing:"-.055em"}}>Petit Annonces,<br/>les petites annonces pensées pour la France.</h1><p style={{maxWidth:760,margin:"20px 0 0",fontSize:17,lineHeight:1.7,opacity:.88}}>Petit Annonces réunit particuliers et professionnels autour d’un même objectif : publier, rechercher, acheter et vendre plus simplement partout en France.</p></div>
     <div style={{display:"grid",placeItems:"center",minHeight:190,border:"1px solid rgba(255,255,255,.15)",borderRadius:24,background:"rgba(255,255,255,.08)"}}>{logo?<img src={logo} alt={name} style={{maxWidth:"78%",maxHeight:92,objectFit:"contain"}}/>:<strong style={{fontSize:28}}>{name}</strong>}</div>
    </div>
   </section>

   <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:14,marginTop:18}}>
    {[
     ["Petites annonces gratuites","Les particuliers peuvent publier gratuitement leurs annonces, sous réserve des règles de publication et de modération."],
     ["Particuliers & professionnels","Les comptes Pro disposent d’une vitrine, d’outils de gestion et de parcours adaptés à une activité régulière."],
     ["Recherche locale","Les annonces sont structurées par catégorie et par ville pour faciliter la découverte de biens et services proches."],
     ["Marketplace évolutive","Véhicules, immobilier, high-tech, maison, services, emploi, vacances et autres univers sont réunis sur une même plateforme."]
    ].map(([title,text])=><article key={title} style={{padding:22,border:"1px solid #e6e4ef",borderRadius:20,background:"#fff"}}><h2 style={{margin:"0 0 8px",fontSize:18}}>{title}</h2><p style={{margin:0,color:"#666775",lineHeight:1.65,fontSize:14}}>{text}</p></article>)}
   </section>

   <section style={{marginTop:18,padding:"28px",border:"1px solid #e6e4ef",borderRadius:22,background:"#fff"}}>
    <span style={{color:"#5b4cf0",fontSize:11,fontWeight:950,letterSpacing:".08em",textTransform:"uppercase"}}>À propos</span>
    <h2 style={{margin:"6px 0 12px",fontSize:"clamp(26px,4vw,38px)",letterSpacing:"-.035em"}}>Présentation courte pour journalistes et partenaires</h2>
    <p style={{margin:0,color:"#5f606d",lineHeight:1.75}}>Petit Annonces est une plateforme française de petites annonces accessible aux particuliers et aux professionnels. Elle permet de publier des annonces, de rechercher par catégorie et localisation, de gérer des échanges depuis un espace utilisateur et d’accéder à des fonctionnalités dédiées aux vendeurs professionnels.</p>
    <p style={{margin:"12px 0 0",color:"#5f606d",lineHeight:1.75}}>La plateforme développe également des parcours spécialisés pour l’automobile, l’immobilier, les objets d’occasion, les services et les vacances, avec une attention portée à la modération, à la confiance et à la simplicité d’utilisation.</p>
   </section>

   <section style={{marginTop:18,padding:"24px",border:"1px solid #e6e4ef",borderRadius:20,background:"#fff"}}><span style={{color:"#5b4cf0",fontSize:11,fontWeight:950,letterSpacing:".08em",textTransform:"uppercase"}}>Dernier communiqué</span><h2 style={{margin:"6px 0 8px",fontSize:24}}>Petit Annonces développe une marketplace française de petites annonces</h2><p style={{margin:"0 0 14px",color:"#666775",lineHeight:1.65}}>Présentation officielle de la plateforme, de son approche locale et de ses outils pour particuliers et professionnels.</p><a href="/presse/petit-annonces-marketplace-francaise" style={{display:"inline-flex",padding:"10px 14px",borderRadius:11,background:"#5b4cf0",color:"#fff",textDecoration:"none",fontWeight:900}}>Lire le communiqué</a></section>

   <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14,marginTop:18}}>
    <article style={{padding:24,border:"1px solid #e6e4ef",borderRadius:20,background:"#fff"}}><h2 style={{margin:"0 0 12px"}}>Liens utiles</h2><div style={{display:"grid",gap:9}}><a href="/" style={{color:"#5143d7",fontWeight:850}}>Accueil</a><a href="/deposer-annonce-gratuite" style={{color:"#5143d7",fontWeight:850}}>Déposer une annonce gratuite</a><a href="/professionnels" style={{color:"#5143d7",fontWeight:850}}>Petit Annonces Pro</a><a href="/vacances" style={{color:"#5143d7",fontWeight:850}}>Vacances</a><a href="/observatoire" style={{color:"#5143d7",fontWeight:850}}>Observatoire des petites annonces</a><a href="/qui-sommes-nous" style={{color:"#5143d7",fontWeight:850}}>Qui sommes-nous ?</a></div></article>
    <article style={{padding:24,border:"1px solid #e6e4ef",borderRadius:20,background:"#fff"}}><h2 style={{margin:"0 0 12px"}}>Contact média</h2><p style={{margin:"0 0 16px",color:"#666775",lineHeight:1.65}}>Pour une demande d’interview, de présentation, de partenariat éditorial ou de précision sur la plateforme, utilisez le centre d’aide en indiquant qu’il s’agit d’une demande presse.</p><a href="/assistance" style={{display:"inline-flex",padding:"11px 15px",borderRadius:12,background:"#5b4cf0",color:"#fff",textDecoration:"none",fontWeight:900}}>Contacter Petit Annonces</a></article>
   </section>
  </main>
 </div>
}