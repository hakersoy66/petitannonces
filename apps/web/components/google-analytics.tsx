"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type AnalyticsEvent = { name?: string; params?: Record<string, unknown> };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __paGaInitialized?: Record<string, boolean>;
  }
}

function ensureGtag(measurementId: string) {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = window.gtag ?? function (...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.__paGaInitialized = window.__paGaInitialized ?? {};

  if (!document.querySelector(`script[data-pa-ga="${measurementId}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.paGa = measurementId;
    document.head.appendChild(script);
  }

  if (!window.__paGaInitialized[measurementId]) {
    window.gtag("js", new Date());
    window.gtag("config", measurementId, { send_page_view: false });
    window.__paGaInitialized[measurementId] = true;
  }
}

function sendPageView(measurementId: string, pathname: string, query: string) {
  const pagePath = `${pathname}${query ? `?${query}` : ""}`;
  window.gtag?.("event", "page_view", {
    send_to: measurementId,
    page_path: pagePath,
    page_location: window.location.href,
    page_title: document.title,
  });
  return pagePath;
}

export function GoogleAnalytics({ measurementId }: { measurementId?: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastPage = useRef("");
  const id = (measurementId ?? "").trim();
  const query = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    if (!id) return;
    ensureGtag(id);

    const onAnalytics = (event: Event) => {
      const detail = (event as CustomEvent<AnalyticsEvent>).detail;
      if (!detail?.name) return;
      ensureGtag(id);
      window.gtag?.("event", detail.name, { ...(detail.params ?? {}), send_to: id });
    };

    window.addEventListener("pa:analytics-event", onAnalytics);
    return () => window.removeEventListener("pa:analytics-event", onAnalytics);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    ensureGtag(id);
    const pagePath = `${pathname}${query ? `?${query}` : ""}`;
    if (lastPage.current === pagePath) return;
    lastPage.current = sendPageView(id, pathname, query);
  }, [id, pathname, query]);

  return null;
}
