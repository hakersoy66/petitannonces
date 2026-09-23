import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LongtailListingPage } from "../../../lib/seo-longtail";
import { PRODUCT_LONGTAILS, fetchProductLongtail } from "../../../lib/seo-product-longtail";

export const revalidate=120;
type Props={params:Promise<{slug:string}>};

export async function generateMetadata({params}:Props):Promise<Metadata>{
  const{slug}=await params;
  const config=PRODUCT_LONGTAILS[slug];
  if(!config)return{title:"Petites annonces | Petit Annonces",robots:{index:false,follow:true}};
  const data=await fetchProductLongtail(config);
  return{
    title:{absolute:config.metaTitle},
    description:config.description,
    alternates:{canonical:`/occasion/${config.slug}`},
    robots:{index:data.total>=3,follow:true},
    openGraph:{type:"website",url:`/occasion/${config.slug}`,title:config.metaTitle,description:config.description},
  };
}

export default async function ProductLongtailPage({params}:Props){
  const{slug}=await params;
  const config=PRODUCT_LONGTAILS[slug];
  if(!config)notFound();
  const data=await fetchProductLongtail(config);
  const extra=<section style={{margin:"0 0 18px",padding:18,border:"1px solid #e7e7ef",borderRadius:18,background:"white"}}>
    <small style={{fontWeight:850,color:"#777887"}}>RECHERCHES ASSOCIÉES</small>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
      {config.related.map(item=><a key={item.href} href={item.href} style={{padding:"9px 12px",border:"1px solid #e4e4ec",borderRadius:999,background:"#fafafe",textDecoration:"none",color:"#5143d7",fontWeight:800,fontSize:12}}>{item.label}</a>)}
    </div>
  </section>;
  return <LongtailListingPage title={config.title} eyebrow={config.eyebrow} description={config.description} data={data} backHref={config.backHref} backLabel={config.backLabel} canonicalPath={`/occasion/${config.slug}`} extra={extra}/>;
}