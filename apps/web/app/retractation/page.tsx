"use client";

import {useState} from "react";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");

export default function WithdrawalPage(){
  const [service,setService]=useState("OPTION_VISIBILITE");
  const [reference,setReference]=useState("");
  const [purchaseDate,setPurchaseDate]=useState("");
  const [details,setDetails]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<{reference:string}|null>(null);
  const [error,setError]=useState("");

  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    const body=[
      "Demande de rétractation en ligne",
      `Service : ${service}`,
      `Référence de commande / paiement : ${reference.trim()||"non renseignée"}`,
      `Date d’achat : ${purchaseDate||"non renseignée"}`,
      "Le consommateur notifie par la présente sa volonté de se rétracter du service Petit Annonces indiqué, sous réserve des conditions légales applicables.",
      details.trim()?`Précisions : ${details.trim()}`:""
    ].filter(Boolean).join("\n");
    try{
      const r=await fetch(`${api()}/support/tickets`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({category:"PAYMENT",subject:`Rétractation · ${service}`,body})});
      if(r.status===401){location.href=`/connexion?next=${encodeURIComponent("/retractation")}`;return}
      const p=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(String(p.error??"request_failed"));
      setResult({reference:String(p.ticket?.reference??"")});
    }catch{setError("La demande n’a pas pu être enregistrée. Réessayez ou contactez info@petitannonces.fr.")}
    finally{setBusy(false)}
  }

  return <main className="shell" style={{maxWidth:820,paddingBlock:52}}>
    <p style={{color:"#5b4cf0",fontWeight:900,textTransform:"uppercase",fontSize:12}}>Droit de la consommation</p>
    <h1 style={{margin:"9px 0 8px"}}>Se rétracter en ligne</h1>
    <p style={{color:"#696779",lineHeight:1.7}}>Cette fonctionnalité permet de notifier en ligne une demande de rétractation concernant un service acheté directement auprès de Petit Annonces. Son enregistrement ne préjuge pas de l’applicabilité du droit de rétractation ni d’une éventuelle exception légale.</p>
    {result?<section style={{marginTop:24,padding:22,borderRadius:18,background:"#edf9f3",border:"1px solid #ccebdc"}}><strong>Votre demande a été enregistrée.</strong><p>Référence : <b>{result.reference}</b></p><p>Conservez cette référence. La demande est transmise au support pour vérification et traitement.</p></section>:<form onSubmit={submit} style={{display:"grid",gap:16,marginTop:26,padding:22,border:"1px solid #e5e3ed",borderRadius:20,background:"#fff"}}>
      <label style={{display:"grid",gap:7,fontWeight:800}}>Service concerné<select value={service} onChange={e=>setService(e.target.value)} style={{padding:13,border:"1px solid #d8d6df",borderRadius:12}}><option value="OPTION_VISIBILITE">Option de visibilité / boost</option><option value="ABONNEMENT_PRO">Abonnement Pro</option><option value="PROLONGATION_ANNONCE">Prolongation d’annonce</option><option value="AUTRE_SERVICE">Autre service Petit Annonces</option></select></label>
      <label style={{display:"grid",gap:7,fontWeight:800}}>Référence de commande ou paiement<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={160} placeholder="Référence affichée dans votre compte ou reçu" style={{padding:13,border:"1px solid #d8d6df",borderRadius:12}}/></label>
      <label style={{display:"grid",gap:7,fontWeight:800}}>Date d’achat<input type="date" value={purchaseDate} onChange={e=>setPurchaseDate(e.target.value)} style={{padding:13,border:"1px solid #d8d6df",borderRadius:12}}/></label>
      <label style={{display:"grid",gap:7,fontWeight:800}}>Précisions facultatives<textarea value={details} onChange={e=>setDetails(e.target.value)} maxLength={1500} rows={5} style={{padding:13,border:"1px solid #d8d6df",borderRadius:12,resize:"vertical"}}/></label>
      <label style={{display:"flex",gap:9,alignItems:"flex-start",fontSize:12,color:"#5f5d6b"}}><input type="checkbox" required/> Je confirme demander la rétractation du service indiqué et l’exactitude des informations fournies.</label>
      {error&&<p style={{color:"#b42318",fontWeight:750}}>{error}</p>}
      <button disabled={busy} style={{minHeight:48,border:0,borderRadius:999,background:"#5b4cf0",color:"#fff",fontWeight:900,cursor:"pointer"}}>{busy?"Enregistrement…":"Confirmer ma demande de rétractation"}</button>
    </form>}
    <section style={{marginTop:24,padding:18,borderRadius:16,background:"#f8f7fb",fontSize:12,lineHeight:1.65,color:"#666475"}}><strong>À savoir</strong><p>Le droit de rétractation dépend du service, de la qualité du client, de la date d’achat et, le cas échéant, du commencement d’exécution demandé. Pour un achat auprès d’un vendeur professionnel tiers, adressez la demande au vendeur concerné.</p><a href="/conditions-generales">Consulter les Conditions générales</a></section>
  </main>;
}
