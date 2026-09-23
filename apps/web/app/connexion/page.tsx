import type { Metadata } from "next";
import { LoginForm } from "../../components/login-form";
import { AppIcon, type AppIconName } from "../../components/app-icon";
import styles from "../auth.module.css";

export const metadata:Metadata={title:"Connexion | Petit Annonces",description:"Connectez-vous à votre compte Petit Annonces."};

type Props={searchParams:Promise<{next?:string;oauth?:string;oauth_error?:string}>};
type HeaderCategory={id:string;name:string;slug:string;domain:string;children?:HeaderCategory[]};
type HeaderBrand={siteName:string;tagline:string;logoUrl:string|null;mobileLogoUrl:string|null;accentColor:string;navigationCategorySlugs?:string[]};
type OauthProviders={google:boolean;apple:boolean};
const FALLBACK_BRAND:HeaderBrand={siteName:"Petit Annonces",tagline:"",logoUrl:null,mobileLogoUrl:null,accentColor:"#5b4cf0"};
const benefits:[[AppIconName,string,string],[AppIconName,string,string],[AppIconName,string,string],[AppIconName,string,string]]=[
 ["list","Gérez vos annonces","Modifiez, mettez en pause, republiez ou marquez vos articles comme vendus."],
 ["comments","Centralisez vos échanges","Retrouvez vos messages, vos offres et vos conversations en un seul endroit."],
 ["credit-card","Suivez vos achats et ventes","Gardez un œil sur vos commandes, paiements, livraisons et litiges."],
 ["shield","Profitez d’un espace plus sûr","Historique, profil et outils de confiance vous accompagnent à chaque transaction."],
];
function safeNext(value?:string){return value&&value.startsWith("/")&&!value.startsWith("//")?value:"/mon-compte"}
async function pageData(){
 const base=(process.env.API_INTERNAL_URL??"http://127.0.0.1:4000").replace(/\/$/,"");
 const [brandResult,categoryResult,oauthResult]=await Promise.allSettled([
  fetch(`${base}/public/site-config`,{next:{revalidate:300}}),
  fetch(`${base}/categories/tree`,{next:{revalidate:300}}),
  fetch(`${base}/auth/oauth/providers`,{cache:"no-store"}),
 ]);
 let brand=FALLBACK_BRAND,categories:HeaderCategory[]=[],oauthProviders:OauthProviders={google:false,apple:false};
 if(brandResult.status==="fulfilled"&&brandResult.value.ok){const payload=await brandResult.value.json() as {site?:Partial<HeaderBrand>};brand={...FALLBACK_BRAND,...(payload.site??{})}}
 if(categoryResult.status==="fulfilled"&&categoryResult.value.ok){const payload=await categoryResult.value.json() as {categories?:HeaderCategory[]};categories=(payload.categories??[]).map(({children:_children,...category})=>category)}
 if(oauthResult.status==="fulfilled"&&oauthResult.value.ok){const payload=await oauthResult.value.json() as Partial<OauthProviders>;oauthProviders={google:Boolean(payload.google),apple:Boolean(payload.apple)}}
 return{brand,categories,oauthProviders};
}

export default async function LoginPage({searchParams}:Props){
 const [query,{brand,categories,oauthProviders}]=await Promise.all([searchParams,pageData()]);
 const nextPath=safeNext(query.next);
 return <div className={styles.page}>
  
  <main className={styles.main}>
   <div className={`${styles.authGrid} ${styles.formFirstMobile}`}>
    <LoginForm oauthProviders={oauthProviders} nextPath={nextPath} initialOauth2fa={query.oauth==="2fa"} initialOauthError={query.oauth_error??null}/>
    <aside className={styles.benefitCard}>
     <span className={styles.eyebrow}>Votre espace personnel</span>
     <h2 className={styles.title}>Tout ce qui compte, au même endroit.</h2>
     <p className={styles.lead}>Connectez-vous pour gagner du temps, répondre plus vite et garder une vue claire sur toute votre activité.</p>
     <div className={styles.benefits}>{benefits.map(([icon,title,text])=><div className={styles.benefit} key={title}><div className={styles.benefitIcon}><AppIcon name={icon}/></div><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
    </aside>
   </div>
  </main>
 </div>;
}
