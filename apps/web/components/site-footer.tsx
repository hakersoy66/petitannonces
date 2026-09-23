type FooterLink={label:string;href:string};
export type FooterGroup={title:string;links:FooterLink[]};
export type FooterConfig={siteName:string;logoUrl:string|null;footerLogoUrl:string|null;footerDescription:string;footerGroups:FooterGroup[]};

const fallback:FooterConfig={
 siteName:"Petit Annonces",logoUrl:null,footerLogoUrl:null,footerDescription:"Achetez, vendez et trouvez près de chez vous, simplement et en confiance.",
 footerGroups:[
  {title:"Petit Annonces",links:[{label:"Qui sommes-nous ?",href:"/qui-sommes-nous"},{label:"Presse & médias",href:"/presse"},{label:"Sécurité",href:"/conformite"},{label:"Confidentialité",href:"/confidentialite"},{label:"Cookies",href:"/cookies"},{label:"Mentions légales",href:"/mentions-legales"}]},
  {title:"Acheter & vendre",links:[{label:"Déposer une annonce",href:"/deposer-une-annonce"},{label:"Rechercher",href:"/recherche"},{label:"Boutiques pro",href:"/professionnels"}]},
  {title:"Aide & compte",links:[{label:"Centre d’aide",href:"/assistance"},{label:"Questions fréquentes",href:"/assistance#faq"},{label:"Signaler un contenu",href:"/signaler-contenu-illicite"},{label:"Mon compte",href:"/mon-compte"}]},
 ],
};
export function SiteFooter({initialConfig}:{initialConfig?:Partial<FooterConfig>}){
 const config:FooterConfig={...fallback,...initialConfig,footerGroups:initialConfig?.footerGroups?.length?initialConfig.footerGroups:fallback.footerGroups};
 const groups=config.footerGroups.map(g=>({...g,links:[...g.links]}));
 const seoGroup:FooterGroup={title:"Catégories populaires",links:[
  {label:"Véhicules d’occasion",href:"/categorie/vehicules"},
  {label:"Immobilier",href:"/categorie/immobilier"},
  {label:"High-tech d’occasion",href:"/categorie/high-tech"},
  {label:"Maison & jardin",href:"/categorie/maison-jardin"},
  {label:"Services",href:"/categorie/services"},
  {label:"Objets de collection",href:"/categorie/collection"},
  {label:"Animaux",href:"/categorie/animaux"},
  {label:"Vélos d’occasion",href:"/categorie/velos"},
  {label:"Publier une annonce gratuite",href:"/deposer-annonce-gratuite"},
  {label:"Conseils achat & vente",href:"/blog"},
 ]};
 if(!groups.some(g=>g.title==="Catégories populaires"))groups.splice(Math.min(1,groups.length),0,seoGroup);
 const info=groups.find(g=>/aide|information/i.test(g.title))??groups[groups.length-1];
 const legal=groups.find(g=>g.title.toLowerCase().includes("petit annonces"))??groups[0];
 if(legal&&!legal.links.some(l=>l.href==="/qui-sommes-nous"))legal.links.unshift({label:"Qui sommes-nous ?",href:"/qui-sommes-nous"});
 if(legal&&!legal.links.some(l=>l.href==="/presse"))legal.links.splice(Math.min(1,legal.links.length),0,{label:"Presse & médias",href:"/presse"});
 if(legal&&!legal.links.some(l=>l.href==="/observatoire"))legal.links.splice(Math.min(2,legal.links.length),0,{label:"Observatoire",href:"/observatoire"});
 if(legal&&!legal.links.some(l=>l.href==="/mentions-legales"))legal.links.push({label:"Mentions légales",href:"/mentions-legales"});
 if(info&&!info.links.some(l=>l.href==="/assistance"))info.links.push({label:"Centre d’aide",href:"/assistance"});
 return <footer className="site-footer"><div className="footer-mobile-simple"><a className="footer-mobile-brand" href="/">Petit Annonces</a><p>{config.footerDescription}</p><div className="footer-mobile-actions"><a href="/assistance">Aide</a><a href="/deposer-une-annonce">Déposer</a><a href="/mon-compte">Mon compte</a></div><div className="footer-mobile-legal"><a href="/qui-sommes-nous">Qui sommes-nous ?</a><a href="/presse">Presse</a><a href="/observatoire">Observatoire</a><a href="/conditions-generales">Conditions</a><a href="/confidentialite">Confidentialité</a><a href="/mentions-legales">Mentions légales</a></div><small>© {new Date().getFullYear()} {config.siteName} · France</small></div><div className="footer-desktop-rich">
   <div className="footer-support-wrap">
    <div className="shell footer-support-band">
      <div><span className="footer-kicker">Besoin d’aide ?</span><strong>Une réponse claire, au bon endroit.</strong><p>Consultez les questions fréquentes ou suivez une demande depuis votre compte.</p></div>
      <div className="footer-support-actions"><a className="footer-primary" href="/assistance">Ouvrir le centre d’aide</a><a className="footer-secondary" href="/assistance#faq">Voir les questions fréquentes</a></div>
    </div>
   </div>
   <div className="shell footer-grid">
    <div className="footer-brand">
      <a className="brand brand-footer" href="/" aria-label={`${config.siteName}, accueil`}>{(config.footerLogoUrl??config.logoUrl)?<img src={config.footerLogoUrl??config.logoUrl??""} alt={config.siteName} className="footer-logo-img"/>:<><span className="brand-mark" aria-hidden="true">pa</span><span className="brand-copy"><strong>{config.siteName}</strong><small>France</small></span></>}</a>
      <p>{config.footerDescription}</p>
      <div className="footer-trust"><span>Protection acheteur</span><span>Paiement & versements</span><span>Support depuis votre compte</span></div>
    </div>
    {groups.map(group=><div key={group.title} className="footer-column"><h3>{group.title}</h3>{group.links.map(link=><a key={`${group.title}-${link.label}`} href={link.href}>{link.label}<span aria-hidden="true">›</span></a>)}</div>)}
   </div>
   <div className="shell footer-bottom"><span>© {new Date().getFullYear()} {config.siteName}</span><div><a href="/conditions-generales">Conditions générales</a><a href="/confidentialite">Confidentialité</a><span>Marketplace pensée pour la France 🇫🇷</span></div></div>
  </div></footer>
}
