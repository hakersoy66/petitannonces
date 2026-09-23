"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pa_cookie_consent_v1";
const POLICY_VERSION = "2026-09-meta";
const CONSENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
type Choices = { analytics: boolean; personalization: boolean; advertising: boolean };
type StoredConsent = Choices & { policyVersion?: string; savedAt?: string };

function anonymousId() {
  const key = "pa_anon_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, value);
  return value;
}

const secondary = { border: "1px solid #d9d7e5", background: "#fff", color: "#222236", borderRadius: 999, padding: "12px 18px", fontWeight: 800, cursor: "pointer" } as const;
const primary = { ...secondary, border: 0, background: "#5b4cf0", color: "#fff" } as const;

export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [compact, setCompact] = useState(false);
  const [choices, setChoices] = useState<Choices>({ analytics: false, personalization: false, advertising: false });

  useEffect(() => {
    const mobileOrStandalone = window.matchMedia("(max-width: 760px)").matches || window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    setCompact(mobileOrStandalone);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { setOpen(true); setReady(true); return; }
      const saved = JSON.parse(raw) as StoredConsent;
      const savedAt = saved.savedAt ? new Date(saved.savedAt).getTime() : 0;
      const valid = saved.policyVersion === POLICY_VERSION && Number.isFinite(savedAt) && Date.now() - savedAt < CONSENT_TTL_MS;
      if (valid) {
        setChoices({ analytics: Boolean(saved.analytics), personalization: Boolean(saved.personalization), advertising: Boolean(saved.advertising) });
        setOpen(false);
      } else {
        localStorage.removeItem(STORAGE_KEY);
        setOpen(true);
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      setOpen(true);
    } finally {
      setReady(true);
    }
  }, []);

  async function save(next: Choices) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, policyVersion: POLICY_VERSION, savedAt: new Date().toISOString() }));
    setChoices(next);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("pa:consent-changed", { detail: next }));
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/privacy/cookies`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ anonymousId: anonymousId(), policyVersion: POLICY_VERSION, source: "WEB", choices: next }) });
    } catch { /* local consent remains authoritative for front-end non-essential loading */ }
  }

  if (!ready) return null;
  if (compact && open) return <div role="dialog" aria-label="Mesure et campagnes" style={{position:"fixed",left:8,right:8,bottom:"calc(72px + env(safe-area-inset-bottom, 0px))",zIndex:100,background:"rgba(255,255,255,.98)",border:"1px solid #e5e2ef",borderRadius:16,padding:12,boxShadow:"0 14px 38px rgba(24,22,55,.18)",display:"grid",gap:10}}><div><strong style={{fontSize:13,color:"#222236"}}>Mesure & campagnes</strong><p style={{margin:"3px 0 0",fontSize:10.5,lineHeight:1.4,color:"#6d6a7b"}}>La mesure d’audience améliore le site. La publicité permet aussi de mesurer les campagnes Meta. Vous gardez le choix.</p></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}><button type="button" style={{...secondary,padding:"9px 7px",fontSize:10.5}} onClick={()=>save({analytics:false,personalization:false,advertising:false})}>Refuser</button><button type="button" style={{...secondary,padding:"9px 7px",fontSize:10.5}} onClick={()=>save({analytics:true,personalization:false,advertising:false})}>Mesure seule</button><button type="button" style={{...primary,padding:"9px 7px",fontSize:10.5}} onClick={()=>save({analytics:true,personalization:true,advertising:true})}>Tout accepter</button></div></div>;
  if (!open) return compact ? null : <button type="button" className="cookie-manage-button" onClick={()=>{setSettings(true);setOpen(true)}} style={{position:"fixed",right:16,bottom:16,zIndex:69,border:"1px solid #d9d7e5",background:"#fff",color:"#36344a",borderRadius:999,padding:"10px 14px",fontWeight:800,fontSize:12,boxShadow:"0 8px 28px rgba(24,22,55,.12)",cursor:"pointer"}}>Gérer les cookies</button>;

  return (
    <div className="cookie-consent-overlay" role="dialog" aria-modal="true" aria-labelledby="cookie-title" style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", alignItems: "end", background: "rgba(18,18,35,.34)", padding: 18 }}>
      <div style={{ width: "min(760px,100%)", margin: "0 auto", background: "#fff", borderRadius: 24, padding: 24, boxShadow: "0 28px 80px rgba(24,22,55,.24)" }}>
        <h2 id="cookie-title" style={{ margin: 0, fontSize: 25 }}>Vos choix de confidentialité</h2>
        <p style={{ color: "#66667a", lineHeight: 1.6, margin: "10px 0 0" }}>Les cookies strictement nécessaires fonctionnent toujours. La mesure d’audience, la personnalisation et la publicité ne sont activées qu’avec votre accord.</p>
        {settings && <div style={{ display: "grid", gap: 10, marginTop: 18 }}>{([['analytics','Mesure d’audience'],['personalization','Personnalisation'],['advertising','Publicité']] as const).map(([key,label]) => <label key={key} style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: "1px solid #ecebf2", borderRadius: 14 }}><input type="checkbox" checked={choices[key]} onChange={(e) => setChoices({ ...choices, [key]: e.target.checked })} /> {label}</label>)}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
          <button type="button" style={secondary} onClick={() => save({ analytics: false, personalization: false, advertising: false })}>Tout refuser</button>
          <button type="button" style={secondary} onClick={() => setSettings(!settings)}>Personnaliser</button>
          {settings ? <button type="button" style={primary} onClick={() => save(choices)}>Enregistrer mes choix</button> : <button type="button" style={primary} onClick={() => save({ analytics: true, personalization: true, advertising: true })}>Tout accepter</button>}
        </div>
      </div>
    </div>
  );
}
