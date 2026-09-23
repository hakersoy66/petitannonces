import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SiteConfig={siteName:string;tagline:string;seoDescription:string;accentColor:string;mobileLogoUrl:string|null;pwaIconUrl:string|null;pwaIcon180Url:string|null;pwaIcon192Url:string|null;pwaIcon512Url:string|null;faviconUrl:string|null};
function imageType(url:string){const clean=url.split("?")[0]?.toLowerCase()??"";if(clean.endsWith(".svg"))return"image/svg+xml";if(clean.endsWith(".webp"))return"image/webp";if(clean.endsWith(".avif"))return"image/avif";if(clean.endsWith(".ico"))return"image/x-icon";if(clean.endsWith(".jpg")||clean.endsWith(".jpeg"))return"image/jpeg";return"image/png"}

async function siteConfig():Promise<SiteConfig>{
  const fallback={siteName:"Petit Annonces",tagline:"Achetez et vendez partout en France",seoDescription:"Achetez et vendez partout en France avec paiement protégé, livraison suivie et boutiques professionnelles.",accentColor:"#5b4cf0",mobileLogoUrl:null as string|null,pwaIconUrl:null as string|null,pwaIcon180Url:null as string|null,pwaIcon192Url:null as string|null,pwaIcon512Url:null as string|null,faviconUrl:null as string|null};
  try{
    const base=process.env.API_INTERNAL_URL??"http://127.0.0.1:4000";
    const r=await fetch(`${base.replace(/\/$/,"")}/public/site-config`,{next:{revalidate:300}});
    if(!r.ok)return fallback;
    const p=await r.json() as{site?:Partial<SiteConfig>};
    return{...fallback,...(p.site??{})};
  }catch{return fallback}
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site=await siteConfig();
  const hasRaster=Boolean(site.pwaIcon192Url&&site.pwaIcon512Url);
  const icons:NonNullable<MetadataRoute.Manifest["icons"]>=hasRaster?[
    {src:site.pwaIcon192Url!,sizes:"192x192",type:"image/png",purpose:"any"},
    {src:site.pwaIcon512Url!,sizes:"512x512",type:"image/png",purpose:"any"},
  ]:site.pwaIconUrl?[
    {src:site.pwaIconUrl,sizes:"any",type:imageType(site.pwaIconUrl),purpose:"any"},
    {src:"/icons/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
    {src:"/icons/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"},
  ]:[
    {src:"/icons/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
    {src:"/icons/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"},
    {src:"/icons/icon-maskable-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"},
  ];
  const shortcutIcon=site.pwaIcon192Url??site.pwaIconUrl??site.mobileLogoUrl??site.faviconUrl??"/icons/icon-192.png";
  const shortcutSizes=site.pwaIcon192Url?"192x192":(site.pwaIconUrl||site.mobileLogoUrl||site.faviconUrl?"any":"192x192");
  const appManifest:MetadataRoute.Manifest&{
    handle_links:"preferred";
    launch_handler:{client_mode:"navigate-existing"};
    scope_extensions:Array<{type:"origin";origin:string}>;
    related_applications:Array<{platform:"webapp";url:string;id:string}|{platform:"play";id:string;url:string}>;
    prefer_related_applications:false;
    share_target:{action:string;method:"GET";enctype:"application/x-www-form-urlencoded";params:{title:string;text:string;url:string}};
  }={
    id:"/",name:site.siteName,short_name:site.siteName.slice(0,30),description:site.seoDescription||site.tagline,
    start_url:"/?source=pwa",scope:"/",display:"standalone",orientation:"portrait-primary",
    handle_links:"preferred",
    launch_handler:{client_mode:"navigate-existing"},
    scope_extensions:[{type:"origin",origin:"https://www.petitannonces.fr"}],
    related_applications:[{platform:"play",id:"fr.petitannonces.petitannoncesapp",url:"https://play.google.com/store/apps/details?id=fr.petitannonces.petitannoncesapp"},{platform:"webapp",url:"/manifest.webmanifest",id:"https://petitannonces.fr/"}],
    prefer_related_applications:false,
    share_target:{action:"/importer-une-annonce?source=pwa-share",method:"GET",enctype:"application/x-www-form-urlencoded",params:{title:"share_title",text:"share_text",url:"share_url"}},
    background_color:"#ffffff",theme_color:site.accentColor||"#5b4cf0",lang:"fr-FR",categories:["shopping","business","lifestyle"],
    icons,
    shortcuts:[
      {name:"Rechercher",short_name:"Rechercher",description:"Rechercher une annonce",url:"/recherche?source=pwa",icons:[{src:shortcutIcon,sizes:shortcutSizes,type:imageType(shortcutIcon)}]},
      {name:"Déposer une annonce",short_name:"Déposer",description:"Publier une nouvelle annonce",url:"/deposer-une-annonce?source=pwa",icons:[{src:shortcutIcon,sizes:shortcutSizes,type:imageType(shortcutIcon)}]},
      {name:"Messages",short_name:"Messages",description:"Ouvrir mes messages",url:"/messages?source=pwa",icons:[{src:shortcutIcon,sizes:shortcutSizes,type:imageType(shortcutIcon)}]},
    ],
  };
  return appManifest;
}
