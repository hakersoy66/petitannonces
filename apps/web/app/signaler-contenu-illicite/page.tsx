"use client";

import { FormEvent, useState } from "react";

export default function DsaNoticePage() {
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      reporterEmail: String(form.get("reporterEmail") || "") || undefined,
      targetType: String(form.get("targetType")),
      targetId: String(form.get("targetId")),
      contentUrl: String(form.get("contentUrl") || "") || undefined,
      legalBasis: String(form.get("legalBasis") || "") || undefined,
      explanation: String(form.get("explanation")),
      goodFaithDeclaration: form.get("goodFaithDeclaration") === "on",
    };
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/dsa/notices`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setError("Le signalement n’a pas pu être enregistré. Vérifiez les informations fournies."); return; }
    setReference(data.notice.reference);
    event.currentTarget.reset();
  }

  return <main className="shell" style={{ paddingBlock: 56, maxWidth: 820 }}>
    <p style={{ color: "#5b4cf0", fontWeight: 900, textTransform: "uppercase", fontSize: 12 }}>Digital Services Act</p>
    <h1 style={{ marginTop: 10 }}>Signaler un contenu potentiellement illicite</h1>
    <p style={{ marginTop: 12, color: "#6c6c7d", lineHeight: 1.7 }}>Ce formulaire est distinct d’un simple signalement communautaire. Il peut être utilisé sans compte et donne une référence de suivi.</p>
    {reference && <div style={{ marginTop: 20, padding: 18, borderRadius: 16, background: "#eaf8f1", color: "#12694f" }}><strong>Signalement reçu.</strong><br />Référence : {reference}</div>}
    {error && <div style={{ marginTop: 20, color: "#b42318" }}>{error}</div>}
    <form onSubmit={submit} style={{ display: "grid", gap: 16, marginTop: 28 }}>
      <label>Email de contact (facultatif)<input name="reporterEmail" type="email" style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>Type de contenu<select name="targetType" defaultValue="LISTING" style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }}><option value="LISTING">Annonce</option><option value="USER">Utilisateur</option><option value="MESSAGE">Message</option><option value="STORE">Boutique</option><option value="OTHER">Autre</option></select></label>
      <label>Identifiant du contenu<input name="targetId" required style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>URL du contenu<input name="contentUrl" type="url" style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>Base juridique supposée (facultatif)<textarea name="legalBasis" rows={3} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label>Pourquoi ce contenu vous paraît-il illicite ?<textarea name="explanation" required minLength={20} rows={7} style={{ display: "block", width: "100%", marginTop: 7, padding: 13, border: "1px solid #ddd", borderRadius: 12 }} /></label>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><input name="goodFaithDeclaration" type="checkbox" required /> Je déclare de bonne foi que les informations fournies sont exactes et complètes à ma connaissance.</label>
      <button type="submit" style={{ border: 0, borderRadius: 999, padding: "14px 20px", background: "#5b4cf0", color: "white", fontWeight: 850, cursor: "pointer" }}>Envoyer le signalement</button>
    </form>
  </main>;
}
