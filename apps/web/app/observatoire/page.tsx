import type {Metadata} from "next";

export const dynamic="force-dynamic";
export const revalidate=300;

export const metadata:Metadata={
 title:{absolute:"Observatoire des petites annonces en France | Petit Annonces"},
 description:"Données actualisées de Petit Annonces : villes les plus actives, catégories les plus représentées, nouvelles annonces et prix médians affichés.",
 alternates:{canonical:"https://petitannonces.fr/observatoire"},
 openGraph:{type:"website",url:"https://petitannonces.fr/observatoire",title:"Observatoire Petit Annonces",description:"Découvrez les tendances du catalogue Petit Annonces à partir des annonces actives en France."}
};

type Data={
 generatedAt:string;
 summary:{total:number;recent30:number;cities:number;categories:number};
 cities:Array<{city:string;slug:string;count:number;recent30:number}>;
 categories:Array<{slug:string;name:string;count:number;recent30:number;priced:number;medianPriceMinor:number|null}>;
 weeks:Array<{week:string;count:number}>;
};

const api=()=> (process.env.API_INTERNAL_URL??process.env.NEXT_PUBLIC_API_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
async function data():Promise<Data|null>{try{const r=await fetch(`${api()}/seo/observatoire`,{next:{revalidate:900}});if(!r.ok)return null;return r.json() as Promise<Data>}catch{return null}}
const nf=(n:number)=>new Intl.NumberFormat("fr-FR").format(n);
const euro=(minor:number|null)=>minor===null?"—":new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(minor/100);
const date=(v:string)=>new Intl.DateTimeFormat("fr-FR",{dateStyle:"long",timeZone:"Europe/Paris"}).format(new Date(v));
const safe=(value:unknown)=>JSON.stringify(value).replace(/</g,"\\u003c");

export default async function ObservatoirePage(){
 const d=await data();
 if(!d)return <main style={{width:"min(980px,calc(100% - 24px))",margin:"0 auto",padding:"48px 0 80px"}}><h1>Observatoire Petit Annonces</h1><p>Les données sont momentanément indisponibles.</p></main>;
 const topCity=Math.max(1,...d.cities.map(x=>x.count));
 const topCat=Math.max(1,...d.categories.map(x=>x.count));
 const dataset={"@context":"https://schema.org","@type":"Dataset",name:"Observatoire Petit Annonces",description:"Statistiques agrégées des annonces actives publiées sur Petit Annonces en France.",url:"https://petitannonces.fr/observatoire",creator:{"@type":"Organization",name:"Petit Annonces",url:"https://petitannonces.fr"},dateModified:d.generatedAt,spatialCoverage:{"@type":"Place",name:"France"},measurementTechnique:"Agrégation des annonces actives publiées sur Petit Annonces"};
 return <div style={{minHeight:"100vh",background:"#f7f7fb",color:"#222331"}}>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safe(dataset)}}/>
  <main style={{width:"min(1160px,calc(100% - 24px))",margin:"0 auto",padding:"30px 0 80px"}}>
   <nav style={{fontSize:13,color:"#747584",marginBottom:14}}><a href="/" style={{color:"#5b4cf0"}}>Accueil</a> › Observatoire</nav>
   <header style={{padding:"clamp(30px,5vw,58px)",borderRadius:28,background:"linear-gradient(135deg,#151522,#332d72 55%,#5b4cf0)",color:"#fff",boxShadow:"0 24px 70px rgba(32,28,79,.16)"}}>
    <span style={{fontSize:11,fontWeight:950,letterSpacing:1.2,textTransform:"uppercase",opacity:.76}}>Données du catalogue</span>
    <h1 style={{maxWidth:850,margin:"10px 0 14px",fontSize:"clamp(38px,6vw,66px)",lineHeight:1,letterSpacing:"-.05em"}}>Observatoire des petites annonces en France</h1>
    <p style={{maxWidth:820,margin:0,fontSize:17,lineHeight:1.72,opacity:.9}}>Une lecture transparente de l’activité réellement visible sur Petit Annonces : villes, catégories, nouvelles publications et prix affichés.</p>
    <p style={{margin:"18px 0 0",fontSize:12,opacity:.7}}>Mise à jour : {date(d.generatedAt)}</p>
   </header>

   <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:18}}>
    {[
     ["Annonces actives",nf(d.summary.total)],
     ["Nouvelles sur 30 jours",nf(d.summary.recent30)],
     ["Villes représentées",nf(d.summary.cities)],
     ["Catégories avec annonces",nf(d.summary.categories)]
    ].map(([label,value])=><article key={label} style={{padding:21,border:"1px solid #e5e4ed",borderRadius:18,background:"#fff"}}><small style={{color:"#777887",fontWeight:850}}>{label}</small><strong style={{display:"block",marginTop:8,fontSize:30,letterSpacing:"-.04em"}}>{value}</strong></article>)}
   </section>

   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:16,marginTop:18}}>
    <section style={{padding:24,border:"1px solid #e5e4ed",borderRadius:22,background:"#fff"}}>
     <small style={{color:"#5b4cf0",fontWeight:950}}>VILLES</small><h2 style={{margin:"6px 0 4px"}}>Où le catalogue est-il le plus actif ?</h2><p style={{margin:"0 0 18px",color:"#696a77",fontSize:13,lineHeight:1.6}}>Seules les villes ayant au moins 3 annonces actives apparaissent dans ce classement.</p>
     <div style={{display:"grid",gap:12}}>{d.cities.slice(0,13).map((x,i)=><a key={x.slug} href={`/ville/${x.slug}`} style={{display:"grid",gridTemplateColumns:"28px minmax(0,1fr) auto",gap:10,alignItems:"center",color:"inherit",textDecoration:"none"}}><strong style={{color:"#8b8c99",fontSize:12}}>#{i+1}</strong><span><strong style={{display:"block",fontSize:14}}>{x.city}</strong><span style={{display:"block",height:6,borderRadius:999,background:"#eeecff",marginTop:6,overflow:"hidden"}}><i style={{display:"block",height:"100%",width:`${Math.max(5,Math.round(x.count/topCity*100))}%`,background:"#5b4cf0",borderRadius:999}}/></span><small style={{display:"block",marginTop:4,color:"#858694"}}>{x.recent30} nouvelle{x.recent30>1?"s":""} sur 30 j</small></span><strong>{nf(x.count)}</strong></a>)}</div>
    </section>

    <section style={{padding:24,border:"1px solid #e5e4ed",borderRadius:22,background:"#fff"}}>
     <small style={{color:"#5b4cf0",fontWeight:950}}>CATÉGORIES</small><h2 style={{margin:"6px 0 4px"}}>Les univers les plus représentés</h2><p style={{margin:"0 0 18px",color:"#696a77",fontSize:13,lineHeight:1.6}}>Le prix médian correspond uniquement aux annonces de la catégorie ayant un prix renseigné supérieur à zéro.</p>
     <div style={{display:"grid",gap:12}}>{d.categories.slice(0,12).map(x=><a key={x.slug} href={`/categorie/${x.slug}`} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:12,alignItems:"center",color:"inherit",textDecoration:"none"}}><span><strong style={{display:"block",fontSize:14}}>{x.name}</strong><span style={{display:"block",height:6,borderRadius:999,background:"#eeecff",marginTop:6,overflow:"hidden"}}><i style={{display:"block",height:"100%",width:`${Math.max(5,Math.round(x.count/topCat*100))}%`,background:"#5b4cf0",borderRadius:999}}/></span><small style={{display:"block",marginTop:4,color:"#858694"}}>{x.recent30} ajout{x.recent30>1?"s":""} récent{x.recent30>1?"s":""} · médiane affichée {x.priced>=3?euro(x.medianPriceMinor):"données insuffisantes"}</small></span><strong>{nf(x.count)}</strong></a>)}</div>
    </section>
   </div>

   <section style={{marginTop:18,padding:24,border:"1px solid #e5e4ed",borderRadius:22,background:"#fff"}}>
    <small style={{color:"#5b4cf0",fontWeight:950}}>ACTIVITÉ</small><h2 style={{margin:"6px 0 12px"}}>Publications par semaine</h2>
    <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.max(1,d.weeks.length)},minmax(42px,1fr))`,gap:8,alignItems:"end",minHeight:190}}>{d.weeks.map(x=>{const max=Math.max(1,...d.weeks.map(w=>w.count));return <div key={x.week} style={{display:"grid",alignItems:"end",gap:6,textAlign:"center"}}><strong style={{fontSize:11}}>{x.count}</strong><span title={date(x.week)} style={{display:"block",height:`${Math.max(10,Math.round(x.count/max*130))}px`,borderRadius:"10px 10px 4px 4px",background:"#5b4cf0"}}/><small style={{fontSize:9,color:"#8a8b98"}}>{new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit"}).format(new Date(x.week))}</small></div>})}</div>
   </section>

   <section style={{marginTop:18,padding:24,border:"1px solid #e5e4ed",borderRadius:22,background:"#fff"}}>
    <small style={{color:"#5b4cf0",fontWeight:950}}>MÉTHODOLOGIE</small><h2 style={{margin:"6px 0 10px"}}>Comment lire ces données ?</h2>
    <p style={{margin:0,color:"#626371",lineHeight:1.75}}>L’Observatoire utilise uniquement les annonces ayant le statut publié au moment du calcul. Il ne constitue ni un indice officiel du marché français, ni une estimation de prix. Les volumes reflètent le catalogue Petit Annonces. Les prix médians sont des prix affichés dans les annonces et peuvent regrouper des biens différents au sein d’une même grande catégorie.</p>
    <p style={{margin:"12px 0 0",color:"#626371",lineHeight:1.75}}>Ces données peuvent être citées avec la mention « Source : Observatoire Petit Annonces » et un lien vers cette page.</p>
   </section>

   <section style={{marginTop:18,padding:24,borderRadius:22,background:"#eeebff",border:"1px solid #ddd7ff",display:"flex",justifyContent:"space-between",gap:18,alignItems:"center",flexWrap:"wrap"}}><div><strong style={{fontSize:20}}>Explorer les annonces derrière les chiffres</strong><p style={{margin:"5px 0 0",color:"#66627c"}}>Consultez les catégories ou publiez gratuitement une annonce.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a href="/recherche" style={{padding:"11px 15px",borderRadius:12,background:"#fff",color:"#5143d7",fontWeight:900,textDecoration:"none"}}>Rechercher</a><a href="/deposer-annonce-gratuite" style={{padding:"11px 15px",borderRadius:12,background:"#5b4cf0",color:"#fff",fontWeight:900,textDecoration:"none"}}>Déposer une annonce</a></div></section>
  </main>
 </div>;
}