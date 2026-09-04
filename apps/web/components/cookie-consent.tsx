"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pa_cookie_consent_v1";
const POLICY_VERSION = "2026-09";

type Choices = { analytics: boolean; personalization: boolean; advertising: boolean };

function anonymousId() {
  const key = "pa_anon_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [choices, setChoices] = useState<Choices>({ analytics: false, personalization: false, advertising: false });

  useEffect(() => { setOpen(!localStorage.getItem(STORAGE_KEY)); }, []);

  async function save(next: Choices) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, policyVersion: POLICY_VERSION, savedAt: new Date().toISOString() }));
    setChoices(next);
    setOpen(false);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/privacy/cookies`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ anonymousId: anonymousId(), policyVersion: POLICY_VERSION, source: "WEB", choices: next }),
      });
    } catch { /* local preference remains authoritative for front-end loading */ }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="cookie-manage-button">Gérer mes cookies</button>;

  return (
    <div className="cookie-layer" role="dialog" aria-modal="true" aria-labelledby="cookie-title">
      <div className="cookie-card">
        <h2 id="cookie-title">Vos choix de confidentialité</h2>
        <p>Les cookies strictement nécessaires fonctionnent toujours. Les cookies de mesure d’audience, personnalisation et publicité ne sont activés qu’avec votre accord.</p>
        {settings && (
          <div className="cookie-settings">
            <label><input type="checkbox" checked={choices.analytics} onChange={(e) => setChoices({ ...choices, analytics: e.target.checked })} /> Mesure d’audience</label>
            <label><input type="checkbox" checked={choices.personalization} onChange={(e) => setChoices({ ...choices, personalization: e.target.checked })} /> Personnalisation</label>
            <label><input type="checkbox" checked={choices.advertising} onChange={(e) => setChoices({ ...choices, advertising: e.target.checked })} /> Publicité</label>
          </div>
        )}
        <div className="cookie-actions">
          <button type="button" className="secondary-button" onClick={() => save({ analytics: false, personalization: false, advertising: false })}>Tout refuser</button>
          <button type="button" className="secondary-button" onClick={() => setSettings(!settings)}>Personnaliser</button>
          {settings ? <button type="button" className="primary-button" onClick={() => save(choices)}>Enregistrer mes choix</button> : <button type="button" className="primary-button" onClick={() => save({ analytics: true, personalization: true, advertising: true })}>Tout accepter</button>}
        </div>
      </div>
    </div>
  );
}
