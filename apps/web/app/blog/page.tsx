import type {Metadata} from "next";

export const metadata:Metadata={
  title:{absolute:"Conseils petites annonces : acheter, vendre et publier | Petit Annonces"},
  description:"Conseils pratiques pour publier une petite annonce gratuite, vendre d’occasion, acheter en sécurité et mieux utiliser Petit Annonces en France.",
  alternates:{canonical:"/blog"},
  openGraph:{
    type:"website",
    url:"/blog",
    title:"Conseils pour acheter, vendre et publier | Petit Annonces",
    description:"Guides pratiques pour réussir vos petites annonces en France."
  }
};

const guides=[
  {href:"/blog/vendre-objet-occasion",eyebrow:"Vendre d’occasion",title:"Comment vendre un objet d’occasion en ligne ?",text:"Prix, photos, description et remise : la checklist pratique avant de publier."},
  {href:"/blog/vendre-entre-particuliers",eyebrow:"Entre particuliers",title:"Vendre entre particuliers : la checklist",text:"Préparez l’annonce, le prix, l’échange, la remise et les informations à conserver."},
  {href:"/blog/rediger-annonce-efficace",eyebrow:"Rédaction",title:"Rédiger une annonce qui attire les bons acheteurs",text:"Une méthode simple pour structurer titre, description, photos, prix et localisation."},
  {href:"/blog/acheter-occasion-securite",eyebrow:"Sécurité",title:"Acheter d’occasion : les vérifications essentielles",text:"Comparez l’offre, vérifiez l’état, l’échange et les modalités avant de payer."},
  {href:"/blog/rediger-annonce-immobiliere",eyebrow:"Immobilier",title:"Rédiger une annonce immobilière entre particuliers",text:"Les informations essentielles pour présenter clairement un bien à vendre ou à louer."},
  {href:"/blog/acheter-smartphone-occasion",eyebrow:"High-tech",title:"Acheter un smartphone d’occasion",text:"Batterie, écran, comptes, réseau, prix et autres vérifications avant l’achat."},
  {href:"/vendre-voiture",eyebrow:"Automobile",title:"Vendre une voiture d’occasion",text:"Le parcours dédié à la vente automobile et les informations à préparer avant publication."},
  {href:"/observatoire",eyebrow:"Données",title:"Observatoire des petites annonces",text:"Villes les plus actives, catégories, nouvelles publications et données agrégées du catalogue."}
];

const tips=[
  {title:"Un titre précis",text:"Indiquez clairement l’objet, la marque ou le modèle lorsque ces informations sont utiles. Un titre compréhensible aide les acheteurs et les moteurs de recherche."},
  {title:"Des photos réellement utiles",text:"Montrez l’article sous plusieurs angles, avec une image de couverture nette et des photos des éventuels défauts."},
  {title:"Une description complète",text:"Précisez l’état, les dimensions ou caractéristiques importantes, ce qui est inclus et les conditions de remise ou de livraison."}
];

function safeJson(value:unknown){return JSON.stringify(value).replace(/</g,"\\u003c")}

export default function BlogPage(){
  const itemList={"@context":"https://schema.org","@type":"ItemList",name:"Guides Petit Annonces",itemListElement:guides.map((g,index)=>({"@type":"ListItem",position:index+1,url:`https://petitannonces.fr${g.href}`,name:g.title}))};
  return <div style={{minHeight:"100vh",background:"#f7f7fb",color:"#20202c"}}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJson(itemList)}}/>
    <main style={{width:"min(1160px,calc(100% - 24px))",margin:"0 auto",padding:"28px 0 72px"}}>
      <section style={{padding:"clamp(28px,5vw,58px)",borderRadius:28,background:"linear-gradient(135deg,#171625,#322c70 56%,#5b4cf0)",color:"#fff",boxShadow:"0 24px 70px rgba(31,27,76,.16)"}}>
        <span style={{display:"inline-block",fontSize:11,fontWeight:900,letterSpacing:1.2,textTransform:"uppercase",opacity:.78}}>Guides & conseils</span>
        <h1 style={{maxWidth:850,margin:"10px 0 14px",fontSize:"clamp(34px,6vw,64px)",lineHeight:1,letterSpacing:"-.045em"}}>Conseils pour acheter, vendre et publier une petite annonce</h1>
        <p style={{maxWidth:780,margin:0,fontSize:"clamp(15px,2vw,18px)",lineHeight:1.7,opacity:.88}}>Des repères simples pour préparer une annonce utile, vendre d’occasion, rechercher près de chez vous et sécuriser vos échanges sur Petit Annonces.</p>
      </section>

      <section style={{marginTop:34}}>
        <div style={{marginBottom:16}}>
          <span style={{color:"#5b4cf0",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:1}}>À lire en priorité</span>
          <h2 style={{margin:"6px 0 0",fontSize:"clamp(26px,4vw,38px)",letterSpacing:"-.035em"}}>Guides pratiques pour les petites annonces</h2>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
          {guides.map(g=><a key={g.href} href={g.href} style={{display:"block",padding:22,border:"1px solid #e5e4ed",borderRadius:20,background:"#fff",color:"inherit",textDecoration:"none",boxShadow:"0 10px 30px rgba(35,32,70,.045)"}}>
            <small style={{color:"#5b4cf0",fontWeight:900,textTransform:"uppercase",letterSpacing:.8}}>{g.eyebrow}</small>
            <h2 style={{margin:"8px 0 9px",fontSize:20,lineHeight:1.18,letterSpacing:"-.02em"}}>{g.title}</h2>
            <p style={{margin:0,color:"#666674",fontSize:13,lineHeight:1.6}}>{g.text}</p>
            <strong style={{display:"inline-block",marginTop:15,color:"#5b4cf0",fontSize:12}}>Lire le guide →</strong>
          </a>)}
        </div>
      </section>

      <section style={{marginTop:34,padding:26,border:"1px solid #e5e4ed",borderRadius:22,background:"#fff"}}>
        <span style={{color:"#5b4cf0",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:1}}>Bien rédiger</span>
        <h2 style={{margin:"6px 0 18px",fontSize:"clamp(24px,3vw,34px)",letterSpacing:"-.03em"}}>Les bases d’une annonce facile à comprendre</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
          {tips.map((tip,index)=><article key={tip.title} style={{padding:18,borderRadius:16,background:"#f8f7ff",border:"1px solid #ece9ff"}}>
            <small style={{color:"#7568e8",fontWeight:900}}>0{index+1}</small>
            <h3 style={{margin:"7px 0 7px",fontSize:17}}>{tip.title}</h3>
            <p style={{margin:0,color:"#686875",fontSize:13,lineHeight:1.6}}>{tip.text}</p>
          </article>)}
        </div>
      </section>

      <section style={{marginTop:24,padding:24,borderRadius:20,background:"#eeebff",border:"1px solid #ddd7ff",display:"flex",alignItems:"center",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}>
        <div><strong style={{display:"block",fontSize:20}}>Prêt à publier ?</strong><span style={{display:"block",marginTop:4,color:"#66627c",fontSize:13}}>Déposez gratuitement votre petite annonce et suivez les étapes guidées.</span></div>
        <a href="/deposer-annonce-gratuite" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:46,padding:"0 17px",borderRadius:13,background:"#5b4cf0",color:"#fff",fontWeight:900,textDecoration:"none",fontSize:13}}>Déposer une annonce gratuite</a>
      </section>
    </main>
  </div>;
}