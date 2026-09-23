const CACHE = "pa-shell-v42";
const OFFLINE_URL = "/offline";
const CORE = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/badge-96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key)));
    // Claim clients only. PwaClient owns the single controlled reload after a worker update.
    // Navigating clients here as well caused duplicate reloads during PWA route changes.
    await self.clients.claim();
  })());
});

function isPrivatePath(pathname) {
  return pathname.startsWith("/api/") ||
    pathname.startsWith("/mon-compte") ||
    pathname.startsWith("/messages") ||
    pathname.startsWith("/commandes") ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/deposer-une-annonce") ||
    pathname.startsWith("/importer-une-annonce") ||
    pathname.startsWith("/connexion") ||
    pathname.startsWith("/espace-pro");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        if (!isPrivatePath(url.pathname)) {
          const cached = await caches.match(event.request);
          if (cached) return cached;
        }
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  if (!["style", "script", "image", "font"].includes(event.request.destination)) return;

  const immutableNextAsset=url.pathname.startsWith("/_next/static/");
  if(immutableNextAsset){
    event.respondWith(
      caches.match(event.request).then((cached)=>cached||fetch(event.request).then((response)=>{
        if(response.ok){const clone=response.clone();caches.open(CACHE).then((cache)=>cache.put(event.request,clone));}
        return response;
      }))
    );
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(event.request);
    const networkPromise=fetch(event.request).then((response)=>{
      if(response.ok){const clone=response.clone();caches.open(CACHE).then((cache)=>cache.put(event.request,clone));}
      return response;
    }).catch(()=>null);
    if(cached){event.waitUntil(networkPromise.then(()=>undefined));return cached;}
    return (await networkPromise)||new Response("",{status:504,statusText:"Offline"});
  })());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil((async () => {
    let brandIcon = "/icons/icon-192.png";
    try {
      const response = await fetch("/api/public/site-config", { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        brandIcon = payload?.site?.pwaIcon192Url || payload?.site?.pwaIconUrl || brandIcon;
      }
    } catch {}
    const title = data.title || "Petit Annonces";
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const fallbackActionUrl = metadata.actionUrl || (metadata.conversationId ? `/messages?conversation=${encodeURIComponent(String(metadata.conversationId))}` : metadata.orderId ? `/commandes/${encodeURIComponent(String(metadata.orderId))}` : metadata.listingSlug ? `/annonce/${encodeURIComponent(String(metadata.listingSlug))}` : metadata.listingId ? `/mon-compte/annonces` : "/mon-compte/notifications");
    const tagSource = metadata.orderId || metadata.conversationId || metadata.listingId || metadata.offerId;
    const badgeCount = Number(data.badgeCount);
    const options = {
      body: data.body || "Vous avez une nouvelle notification.",
      icon: brandIcon,
      badge: "/icons/badge-96.png",
      tag: tagSource ? `pa-${String(tagSource)}` : undefined,
      renotify: Boolean(tagSource),
      data: { url: data.actionUrl || data.url || fallbackActionUrl, actionUrl: data.actionUrl || fallbackActionUrl || null, notificationId: data.notificationId || null },
    };
    await Promise.all([
      self.registration.showNotification(title, options),
      Number.isFinite(badgeCount) && badgeCount >= 0 && self.navigator?.setAppBadge
        ? (badgeCount > 0 ? self.navigator.setAppBadge(Math.floor(badgeCount)) : self.navigator.clearAppBadge?.())
        : Promise.resolve(),
    ]);
  })());
});

async function applyAppBadge(count) {
  try {
    const safeCount = Math.max(0, Number(count || 0));
    if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(safeCount);
    if (safeCount === 0 && self.navigator?.clearAppBadge) await self.navigator.clearAppBadge();
  } catch {}
}

async function broadcastNotificationCount(count) {
  try {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try { client.postMessage({ type: "NOTIFICATION_COUNT", count: Math.max(0, Number(count || 0)) }); } catch {}
    }
  } catch {}
}

async function syncBadgeFromServer() {
  try {
    const response = await fetch("/api/account/message-summary", { credentials: "include", cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    const count = Math.max(0, Number(payload.unreadNotifications || 0));
    await applyAppBadge(count);
    await broadcastNotificationCount(count);
    return count;
  } catch { return null; }
}

async function markNotificationRead(notificationId) {
  if (!notificationId) return syncBadgeFromServer();
  try {
    const response = await fetch(`/api/account/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST", credentials: "include", cache: "no-store" });
    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const count = Math.max(0, Number(payload?.unread || 0));
      await applyAppBadge(count);
      await broadcastNotificationCount(count);
      return count;
    }
  } catch {}
  return syncBadgeFromServer();
}

function sameTarget(clientUrl, targetUrl) {
  try {
    const a = new URL(clientUrl);
    const b = new URL(targetUrl);
    return a.origin === b.origin && `${a.pathname}${a.search}${a.hash}` === `${b.pathname}${b.search}${b.hash}`;
  } catch { return false; }
}

async function openNotificationTarget(targetUrl) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (windows.length === 0) {
    if (self.clients.openWindow) {
      try { await self.clients.openWindow(targetUrl); } catch {}
    }
    return;
  }

  const exact = windows.find((item) => sameTarget(item.url, targetUrl));
  const client = exact || windows.find((item) => item.visibilityState === "visible") || windows.find((item) => String(item.url || "").startsWith(self.location.origin)) || windows[0];

  try { if ("focus" in client) await client.focus(); } catch {}
  try { client.postMessage({ type: "NAVIGATE_TO", url: targetUrl, source: "notificationclick" }); } catch {}

  await new Promise((resolve) => setTimeout(resolve, 140));
  try {
    const refreshed = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const arrived = refreshed.find((item) => sameTarget(item.url, targetUrl));
    if (arrived) {
      try { if ("focus" in arrived) await arrived.focus(); } catch {}
      return;
    }
  } catch {}

  try {
    if ("navigate" in client) {
      const navigated = await client.navigate(targetUrl);
      try { if (navigated && "focus" in navigated) await navigated.focus(); } catch {}
      return;
    }
  } catch {}

  try { client.postMessage({ type: "NAVIGATE_TO", url: targetUrl, source: "notificationclick-fallback" }); } catch {}
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data?.actionUrl || event.notification.data?.url || "/mon-compte/notifications";
  const notificationId = event.notification.data?.notificationId || null;
  let targetUrl = new URL("/mon-compte/notifications", self.location.origin).href;
  try {
    const parsed = new URL(raw, self.location.origin);
    if (parsed.origin === self.location.origin) targetUrl = parsed.href;
  } catch {}
  event.waitUntil((async () => {
    await markNotificationRead(notificationId);
    await openNotificationTarget(targetUrl);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_APP_BADGE") return;
  event.waitUntil((async () => {
    try {
      if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(0);
      if (self.navigator?.clearAppBadge) await self.navigator.clearAppBadge();
    } catch {}
  })());
});
