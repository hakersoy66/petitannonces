"use client";

import { FormEvent, useEffect, useState } from "react";

const ADMIN_ROLES = new Set(["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"]);

type LoginReply = { authenticated?: boolean; twoFactorRequired?: boolean; challengeToken?: string; error?: string };

type MeReply = { user?: { roles?: string[]; profile?: { displayName?: string | null } | null } };

async function verifyAdmin() {
  const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
  if (!response.ok) return false;
  const payload = await response.json() as MeReply;
  return (payload.user?.roles ?? []).some(role => ADMIN_ROLES.has(role));
}

export default function AdminLoginPage() {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [challenge,setChallenge]=useState("");
  const [code,setCode]=useState("");

  useEffect(()=>{ void (async()=>{ if(await verifyAdmin()) window.location.replace("/"); })(); },[]);

  async function finishLogin() {
    if (await verifyAdmin()) { window.location.replace("/"); return; }
    await fetch("/api/auth/logout", { method:"POST", credentials:"include" }).catch(()=>undefined);
    setError("Ce compte n’est pas autorisé à accéder à l’administration.");
  }

  async function submit(e:FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const response=await fetch("/api/auth/login",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
      const payload=await response.json().catch(()=>({})) as LoginReply;
      if(!response.ok){
        setError(payload.error==="invalid_credentials"?"E-mail ou mot de passe incorrect.":payload.error==="account_temporarily_locked"?"Compte temporairement verrouillé. Réessayez plus tard.":"Connexion impossible.");
        return;
      }
      if(payload.twoFactorRequired&&payload.challengeToken){setChallenge(payload.challengeToken);return}
      await finishLogin();
    } catch {
      setError("Connexion impossible. Vérifiez votre connexion réseau puis réessayez.");
    } finally { setBusy(false); }
  }

  async function submit2fa(e:FormEvent){
    e.preventDefault(); setBusy(true); setError("");
    try{
      const response=await fetch("/api/auth/2fa/complete",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({challengeToken:challenge,code})});
      if(!response.ok){setError("Code de vérification incorrect ou expiré.");return}
      await finishLogin();
    }catch{
      setError("Vérification impossible. Vérifiez votre connexion réseau puis réessayez.");
    }finally{setBusy(false)}
  }

  return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",padding:"max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))",background:"radial-gradient(circle at 20% 10%,#eeeaff 0,transparent 32%),radial-gradient(circle at 85% 80%,#e8faf4 0,transparent 30%),#f8f8fc",color:"#1d1c2d",fontFamily:"Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
    <section style={{width:"min(460px,100%)",background:"rgba(255,255,255,.96)",border:"1px solid #e6e3f1",borderRadius:24,padding:"clamp(22px,6vw,34px)",boxShadow:"0 24px 70px rgba(43,35,96,.12)"}}>
      <div style={{display:"flex",alignItems:"center",gap:13,marginBottom:28}}>
        <div style={{width:48,height:48,borderRadius:15,display:"grid",placeItems:"center",background:"#5b4cf0",color:"white",fontWeight:950,fontSize:18}}>PA</div>
        <div><strong style={{display:"block",fontSize:18}}>Petit Annonces</strong><span style={{color:"#747184",fontSize:12,fontWeight:750}}>Administration sécurisée</span></div>
      </div>
      <p style={{margin:"0 0 7px",color:"#5b4cf0",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".1em"}}>Operations Center</p>
      <h1 style={{margin:"0 0 9px",fontSize:30,lineHeight:1.12,letterSpacing:"-.035em"}}>{challenge?"Vérification en deux étapes":"Connexion administrateur"}</h1>
      <p style={{margin:"0 0 25px",color:"#747184",fontSize:14,lineHeight:1.6}}>{challenge?"Saisissez le code de sécurité de votre compte.":"Utilisez votre compte Petit Annonces autorisé pour accéder aux outils d’administration."}</p>
      {!challenge?<form onSubmit={submit} style={{display:"grid",gap:15}}>
        <label style={{display:"grid",gap:7,fontSize:13,fontWeight:800}}>Adresse e-mail<input autoComplete="email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} style={inputStyle}/></label>
        <label style={{display:"grid",gap:7,fontSize:13,fontWeight:800}}>Mot de passe<input autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={inputStyle}/></label>
        {error&&<div style={errorStyle}>{error}</div>}
        <button disabled={busy} style={buttonStyle}>{busy?"Connexion…":"Se connecter"}</button>
      </form>:<form onSubmit={submit2fa} style={{display:"grid",gap:15}}>
        <label style={{display:"grid",gap:7,fontSize:13,fontWeight:800}}>Code de sécurité<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)} style={inputStyle} placeholder="000000"/></label>
        {error&&<div style={errorStyle}>{error}</div>}
        <button disabled={busy} style={buttonStyle}>{busy?"Vérification…":"Vérifier et continuer"}</button>
        <button type="button" onClick={()=>{setChallenge("");setCode("");setError("")}} style={{border:0,background:"transparent",color:"#615c74",fontWeight:800,cursor:"pointer"}}>Retour</button>
      </form>}
      <div style={{marginTop:22,paddingTop:18,borderTop:"1px solid #efedf5",display:"flex",gap:9,alignItems:"flex-start",color:"#777486",fontSize:11.5,lineHeight:1.5}}><span style={{fontSize:15}}>🔒</span><span>Accès réservé aux comptes disposant d’un rôle d’administration. Les actions sensibles restent protégées côté API.</span></div>
    </section>
  </main>;
}

const inputStyle={width:"100%",boxSizing:"border-box" as const,height:50,border:"1px solid #dcd8e8",borderRadius:13,padding:"0 14px",background:"#fff",font:"inherit",fontSize:16,color:"#242232",outline:"none"};
const buttonStyle={height:52,border:0,borderRadius:14,background:"#5b4cf0",color:"#fff",fontWeight:900,fontSize:14,cursor:"pointer",boxShadow:"0 10px 24px rgba(91,76,240,.22)"};
const errorStyle={padding:"11px 13px",borderRadius:11,background:"#fff1f2",border:"1px solid #fecdd3",color:"#9f1239",fontSize:12.5,fontWeight:700};
