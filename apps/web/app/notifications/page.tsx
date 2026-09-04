"use client";

import { useState } from "react";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export default function NotificationsPage() {
  const [status, setStatus] = useState<string>("Les notifications sont désactivées.");

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("Les notifications push ne sont pas prises en charge sur cet appareil.");
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
    if (!publicKey) {
      setStatus("La clé push publique n’est pas encore configurée.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Autorisation de notification refusée.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    const json = subscription.toJSON();
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/notifications/push/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "WEB", endpoint: subscription.endpoint, keys: json.keys, deviceLabel: navigator.platform }),
    });
    setStatus(response.ok ? "Notifications activées sur cet appareil." : "Impossible d’enregistrer cet appareil.");
  }

  return <main className="shell" style={{ paddingBlock: 54, maxWidth: 760 }}>
    <p style={{ color: "#5b4cf0", fontWeight: 850, textTransform: "uppercase", fontSize: 12 }}>Mobile & PWA</p>
    <h1 style={{ marginTop: 8 }}>Notifications</h1>
    <p style={{ marginTop: 12, color: "#6c6c7d", lineHeight: 1.7 }}>Recevez les nouveaux messages, offres, mises à jour de commandes et alertes de sécurité. Les promotions restent désactivables séparément.</p>
    <section style={{ marginTop: 24, border: "1px solid #e7e7ee", borderRadius: 20, padding: 22 }}>
      <h2>Notifications push</h2>
      <p style={{ marginTop: 8, color: "#6c6c7d" }}>{status}</p>
      <button type="button" onClick={enablePush} className="button button-primary" style={{ marginTop: 18 }}>Activer les notifications</button>
    </section>
  </main>;
}
