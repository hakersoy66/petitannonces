import type {Metadata} from "next";
import UnsubscribeClient from "./unsubscribe-client";

export const metadata:Metadata={title:"Se désinscrire de la prospection | Petit Annonces",robots:{index:false,follow:false}};
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
function one(v:string|string[]|undefined){return Array.isArray(v)?v[0]:v}
export default async function UnsubscribePage({searchParams}:Props){const q=await searchParams,token=one(q.token)??"";return <div style={{minHeight:"100vh",background:"#f7f7fb"}}><main style={{maxWidth:680,margin:"0 auto",padding:"70px 20px"}}><section style={{background:"#fff",border:"1px solid #e8e7f2",borderRadius:22,padding:"34px",boxShadow:"0 12px 45px rgba(40,35,90,.06)"}}><span style={{display:"inline-block",fontWeight:900,color:"#5b4cf0",marginBottom:10}}>Petit Annonces</span>{token?<UnsubscribeClient token={token}/>:<><h1 style={{fontSize:30}}>Lien invalide</h1><p style={{color:"#626276"}}>Ce lien de désinscription est incomplet ou a expiré.</p></>}</section></main></div>}

