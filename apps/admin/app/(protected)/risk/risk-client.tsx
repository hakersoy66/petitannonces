"use client";
import{useEffect,useMemo,useState}from"react";

type Signal={code:string;weight:number;detail:string};
type RiskItem={userId:string;score:number;level:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";signals:Signal[];messagingRestrictedUntil:string|null;offerRestrictedUntil:string|null;reviewRequired:boolean;commerceReviewRequired:boolean;lastEventAt:string|null;assessedAt:string;email:string;kind:string;status:string;createdAt:string;name:string;eventCount30d:number};
type Payload={items:RiskItem[];summary:Array<{level:string;count:number}>;reviewRequired:number;restricted:number};
type OrderRisk={orderId:string;orderNumber:string;orderStatus:string;totalAmountMinor:number;sellerNetMinor:number;currency:string;orderCreatedAt:string;buyerName:string;buyerEmail:string;sellerName:string;sellerEmail:string;buyerRiskScore:number;sellerRiskScore:number;orderRiskScore:number;buyerRiskLevel:string;sellerRiskLevel:string;signals:Signal[];paymentGate:"CLEAR"|"REVIEW";paymentResolution:"APPROVED"|"REJECTED"|null;payoutGate:"CLEAR"|"HOLD";payoutResolution:"APPROVED"|"REJECTED"|null;newSeller:boolean;highValue:boolean;sellerCompletedSales:number;reviewNote?:string|null};
type OrderPayload={items:OrderRisk[];summary:{payment:number;payout:number;rejected:number}};

const label:Record<string,string>={LOW:"Faible",MEDIUM:"Moyen",HIGH:"Élevé",CRITICAL:"Critique"};
function badge(level:string){return level==="LOW"?"green":level==="MEDIUM"?"orange":"red"}
function fmt(value?:string|null){return value?new Date(value).toLocaleString("fr-FR"):"—"}
function money(value:number,currency="EUR"){return new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format(Number(value??0)/100)}
function restricted(item:RiskItem){const now=Date.now();return Boolean((item.messagingRestrictedUntil&&new Date(item.messagingRestrictedUntil).getTime()>now)||(item.offerRestrictedUntil&&new Date(item.offerRestrictedUntil).getTime()>now))}

export default function RiskClient(){
 const[data,setData]=useState<Payload>({items:[],summary:[],reviewRequired:0,restricted:0});
 const[orders,setOrders]=useState<OrderPayload>({items:[],summary:{payment:0,payout:0,rejected:0}});
 const[level,setLevel]=useState("");
 const[orderState,setOrderState]=useState<"all"|"payment"|"payout">("all");
 const[busy,setBusy]=useState(false);
 const[msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
 async function load(){
  setBusy(true);
  const [usersRes,ordersRes]=await Promise.all([
   fetch(`/api/admin/risk/overview${level?`?level=${level}`:""}`,{credentials:"include",cache:"no-store"}),
   fetch(`/api/admin/risk/orders?state=${orderState}`,{credentials:"include",cache:"no-store"}),
  ]);
  if(usersRes.ok)setData(await usersRes.json());else setMsg({ok:false,text:"Impossible de charger les profils de risque."});
  if(ordersRes.ok)setOrders(await ordersRes.json());else setMsg({ok:false,text:"Impossible de charger les vérifications de transaction."});
  setBusy(false);
 }
 useEffect(()=>{void load()},[level,orderState]);
 const counts=useMemo(()=>Object.fromEntries(data.summary.map(x=>[x.level,x.count])),[data.summary]);
 async function refresh(id:string){const r=await fetch(`/api/admin/risk/users/${id}/refresh`,{method:"POST",credentials:"include"});setMsg({ok:r.ok,text:r.ok?"Score de risque recalculé.":"Recalcul impossible."});if(r.ok)await load()}
 async function restrict(id:string,hours:number){const r=await fetch(`/api/admin/risk/users/${id}/restriction`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({hours,reason:hours===0?"Restriction levée depuis le Centre de risque":"Restriction manuelle depuis le Centre de risque"})});setMsg({ok:r.ok,text:r.ok?(hours===0?"Restriction levée.":`Restriction appliquée pour ${hours} h.`):"Action impossible."});if(r.ok)await load()}
 async function reviewOrder(orderId:string,kind:"payment"|"payout",action:"APPROVE"|"REJECT"){
  const verb=action==="APPROVE"?"validation":"refus";
  const note=window.prompt(`Note interne pour ${verb} (${kind==="payment"?"paiement":"versement"}) :`,"")??"";
  const r=await fetch(`/api/admin/risk/orders/${orderId}/${kind}-review`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({action,note:note.trim()||undefined})});
  setMsg({ok:r.ok,text:r.ok?(action==="APPROVE"?"Vérification validée.":"Transaction refusée après vérification."):"Impossible d’enregistrer la décision."});
  if(r.ok)await load();
 }
 return <>
  <div className="admin-page-head"><div><p>Sécurité</p><h1>Centre de risque</h1><span className="subtitle">Détection antifraude, restrictions comportementales et contrôle des transactions avant paiement ou versement.</span></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><select className="admin-select" value={level} onChange={e=>setLevel(e.target.value)}><option value="">Tous les niveaux</option><option value="CRITICAL">Critique</option><option value="HIGH">Élevé</option><option value="MEDIUM">Moyen</option><option value="LOW">Faible</option></select><button type="button" className="admin-btn" onClick={()=>void load()} disabled={busy}>Actualiser</button></div></div>
  {msg&&<div className={`admin-flash ${msg.ok?"ok":"err"}`}>{msg.text}</div>}
  <div className="admin-grid admin-kpis">
   <article className="admin-card admin-kpi"><small>Paiements à vérifier</small><strong>{orders.summary.payment}</strong><p>avant ouverture du paiement</p></article>
   <article className="admin-card admin-kpi"><small>Versements à vérifier</small><strong>{orders.summary.payout}</strong><p>avant sortie des fonds</p></article>
   <article className="admin-card admin-kpi"><small>Risque critique</small><strong>{counts.CRITICAL??0}</strong><p>profils prioritaires</p></article>
   <article className="admin-card admin-kpi"><small>Restrictions actives</small><strong>{data.restricted}</strong><p>messages ou offres limités</p></article>
  </div>

  <section className="admin-card admin-section" style={{marginTop:18}}>
   <div className="admin-section-head"><div><h2>Vérifications de transaction</h2><p>Les paiements critiques attendent une validation. Les ventes à risque ou les nouvelles ventes de valeur élevée peuvent être payées, mais le versement du vendeur reste retenu jusqu’à validation.</p></div><select className="admin-select" value={orderState} onChange={e=>setOrderState(e.target.value as typeof orderState)}><option value="all">Toutes</option><option value="payment">Paiement à vérifier</option><option value="payout">Versement à vérifier</option></select></div>
   <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Commande</th><th>Acheteur / vendeur</th><th>Risque</th><th>Contrôles</th><th>Signaux</th><th>Décision</th></tr></thead><tbody>
    {orders.items.map(item=><tr key={item.orderId}>
     <td><strong>{item.orderNumber}</strong><br/><small>{money(item.totalAmountMinor,item.currency)} · net {money(item.sellerNetMinor,item.currency)}</small><br/><small>{item.orderStatus} · {new Date(item.orderCreatedAt).toLocaleDateString("fr-FR")}</small></td>
     <td><small>Acheteur</small><br/><strong>{item.buyerName}</strong><br/><small>{item.buyerEmail}</small><br/><small style={{display:"block",marginTop:6}}>Vendeur</small><strong>{item.sellerName}</strong><br/><small>{item.sellerEmail}</small></td>
     <td><span className={`admin-badge ${badge(item.orderRiskScore>=75?"CRITICAL":item.orderRiskScore>=55?"HIGH":item.orderRiskScore>=25?"MEDIUM":"LOW")}`}>{item.orderRiskScore}/100</span><br/><small>Acheteur {item.buyerRiskScore} · vendeur {item.sellerRiskScore}</small>{item.newSeller&&<><br/><small>Nouveau vendeur · {item.sellerCompletedSales} vente(s) terminée(s)</small></>}{item.highValue&&<><br/><small>Valeur élevée</small></>}</td>
     <td><div style={{display:"grid",gap:6}}><span className={`admin-badge ${item.paymentGate==="REVIEW"?(item.paymentResolution==="APPROVED"?"green":"orange"):"green"}`}>Paiement · {item.paymentGate==="CLEAR"?"Libre":item.paymentResolution??"À vérifier"}</span><span className={`admin-badge ${item.payoutGate==="HOLD"?(item.payoutResolution==="APPROVED"?"green":"orange"):"green"}`}>Versement · {item.payoutGate==="CLEAR"?"Libre":item.payoutResolution??"Retenu"}</span></div></td>
     <td>{item.signals?.length?<div style={{display:"grid",gap:4}}>{item.signals.slice(0,5).map(s=><small key={s.code}><strong>+{s.weight}</strong> {s.detail}</small>)}</div>:<small>Aucun signal commerce</small>}</td>
     <td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{item.paymentGate==="REVIEW"&&!item.paymentResolution&&<><button type="button" className="admin-btn primary" onClick={()=>void reviewOrder(item.orderId,"payment","APPROVE")}>Autoriser paiement</button><button type="button" className="admin-btn" onClick={()=>void reviewOrder(item.orderId,"payment","REJECT")}>Refuser</button></>}{item.payoutGate==="HOLD"&&!item.payoutResolution&&<><button type="button" className="admin-btn primary" onClick={()=>void reviewOrder(item.orderId,"payout","APPROVE")}>Autoriser versement</button><button type="button" className="admin-btn" onClick={()=>void reviewOrder(item.orderId,"payout","REJECT")}>Maintenir bloqué</button></>}{item.paymentResolution&&<small>Paiement : {item.paymentResolution}</small>}{item.payoutResolution&&<small>Versement : {item.payoutResolution}</small>}</div></td>
    </tr>)}
    {!orders.items.length&&<tr><td colSpan={6}><div className="admin-empty">{busy?"Chargement…":"Aucune transaction à vérifier dans cette vue."}</div></td></tr>}
   </tbody></table></div>
  </section>

  <section className="admin-card admin-section" style={{marginTop:18}}>
   <div className="admin-section-head"><div><h2>Profils évalués</h2><p>Le score combine les signaux observés par le système, les signalements, blocages, litiges et risques liés aux annonces. Les plaintes seules ne déclenchent pas une restriction automatique.</p></div></div>
   <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Utilisateur</th><th>Risque</th><th>Signaux</th><th>Restrictions</th><th>Activité</th><th>Actions</th></tr></thead><tbody>
    {data.items.map(item=><tr key={item.userId}><td><strong>{item.name}</strong><br/><small>{item.email}</small><br/><small>{item.kind} · inscrit {new Date(item.createdAt).toLocaleDateString("fr-FR")}</small></td><td><span className={`admin-badge ${badge(item.level)}`}>{label[item.level]} · {item.score}/100</span>{item.reviewRequired&&<><br/><small>Examen requis</small></>}{item.commerceReviewRequired&&<><br/><small>Commerce à vérifier</small></>}</td><td>{item.signals?.length?<div style={{display:"grid",gap:4}}>{item.signals.slice(0,4).map(s=><small key={s.code}><strong>+{s.weight}</strong> {s.detail}</small>)}{item.signals.length>4&&<small>+ {item.signals.length-4} autre(s) signal(aux)</small>}</div>:<small>Aucun signal actif</small>}</td><td>{restricted(item)?<><span className="admin-badge orange">Limité</span><br/><small>Messages : {fmt(item.messagingRestrictedUntil)}</small><br/><small>Offres : {fmt(item.offerRestrictedUntil)}</small></>:<span className="admin-badge green">Libre</span>}</td><td><strong>{item.eventCount30d??0}</strong> événement(s) / 30 j<br/><small>Évalué : {fmt(item.assessedAt)}</small></td><td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button type="button" className="admin-btn" onClick={()=>void refresh(item.userId)}>Recalculer</button><button type="button" className="admin-btn" onClick={()=>void restrict(item.userId,2)}>Limiter 2 h</button><button type="button" className="admin-btn" onClick={()=>void restrict(item.userId,24)}>Limiter 24 h</button>{restricted(item)&&<button type="button" className="admin-btn" onClick={()=>void restrict(item.userId,0)}>Lever</button>}<a className="admin-btn" href={`/users/${item.userId}`}>Utilisateur</a></div></td></tr>)}
    {!data.items.length&&<tr><td colSpan={6}><div className="admin-empty">{busy?"Chargement…":"Aucun profil dans cette vue."}</div></td></tr>}
   </tbody></table></div>
  </section>
 </>
}