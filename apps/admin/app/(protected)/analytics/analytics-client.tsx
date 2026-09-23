"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  d: string;
  newUsers: number;
  newListings: number;
  publishedListings: number;
  orders: number;
  paidOrders: number;
  gmvMinor: number;
  revenueMinor: number;
};

type Audience = {
  visitors: number;
  sessions: number;
  pageViews: number;
  pwaSessions: number;
  source: string;
};
type DailyAudience = { d: string; visitors: number; sessions: number; pageViews: number; metaVisitors: number; metaSessions: number };
type TrafficSource = { source: string; visitors: number; sessions: number; pageViews: number };
type SignupSource = { source: string; count: number };
type RecentSignupSource = { createdAt: string; kind: string; status: string; source: string; medium: string; campaign: string | null; landingPath: string | null };
type MetaStatus = { pixelId: string | null; pixelConfigured: boolean; capiConfigured: boolean; testMode: boolean };

type Ga4 = {
  measurementId: string;
  propertyId: string | null;
  serviceAccountEmail: string | null;
  tagConfigured: boolean;
  reportingConnected: boolean;
  consentRequired: boolean;
  connected: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  activeUsers: number;
  totalUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  eventCount: number;
  keyEvents: number;
  engagementRate: number;
  bounceRate: number;
  averageSessionDuration: number;
  channels: Array<{ name: string; sessions: number; users: number }>;
  pages: Array<{ path: string; views: number; users: number }>;
  keyEventAdmin?: {
    connected: boolean;
    propertyId: string | null;
    serviceAccountEmail: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    events: Array<{ name: string; eventName: string; createTime: string | null; custom: boolean }>;
  };
};

type Organic = {
  connected: boolean;
  gsc: {
    connected: boolean;
    siteUrl: string;
    serviceAccountEmail: string | null;
    source: "GOOGLE_API" | "WINDSOR_SNAPSHOT" | null;
    syncedAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startDate: string | null;
    endDate: string | null;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  };
  ga4: { connected: boolean; propertyId: string | null; errorCode: string | null; errorMessage: string | null; sessions:number; signUps:number; listingsSubmitted:number; checkoutStarts:number; purchases:number };
  firstParty: { sessions:number; visitors:number; signUps:number; listingsSubmitted:number; checkoutStarts:number; purchases:number };
  funnel: { impressions: number; clicks: number; sessions: number; signUps: number; listingsSubmitted: number; checkoutStarts: number; purchases: number };
  landingPages: Array<{ path: string; clicks: number; impressions: number; ctr: number; position: number; sessions: number; signUps: number; listingsSubmitted: number; checkoutStarts: number; purchases: number }>;
  queries: Array<{ query: string; page: string; clicks: number; impressions: number; ctr: number; position: number; landingMetrics: { sessions: number; signUps: number; listingsSubmitted: number; checkoutStarts:number; purchases: number } | null; conversionScope: "LANDING_PAGE" }>;
  queryAttribution: string;
  gscDetailRowsAreTopRows: boolean;
};


type CheckoutRecovery = {
  days:number;
  config:{firstDelayMinutes:number;secondDelayHours:number;expireDelayHours:number;emailProvider:string};
  summary:{abandoned:number;over24h:number;firstReminders:number;secondReminders:number;recovered:number;recoveredGmvMinor:number};
  items:Array<{id:string;orderNumber:string;status:string;paymentProvider:string|null;currency:string;totalAmountMinor:number;createdAt:string;paidAt:string|null;title:string|null;firstReminderAt:string|null;secondReminderAt:string|null}>;
};

type Data = {
  days: number;
  summary: {
    newUsers: number;
    newListings: number;
    publishedListings: number;
    orders: number;
    paidOrders: number;
    gmvMinor: number;
    revenueMinor: number;
    disputes: number;
    supportTickets: number;
  };
  audience: Audience;
  dailyAudience: DailyAudience[];
  trafficSources: TrafficSource[];
  signupSourcesToday: SignupSource[];
  recentSignupSourcesToday: RecentSignupSource[];
  meta: MetaStatus;
  ga4: Ga4;
  organic: Organic;
  series: Row[];
  listingStatuses: { status: string; count: number }[];
  userKinds: { kind: string; count: number }[];
};

const euro = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n / 100);
const money = (n:number,currency="EUR") => new Intl.NumberFormat("fr-FR",{style:"currency",currency}).format((n||0)/100);
const n = (v: number) => Number(v || 0).toLocaleString("fr-FR");
const pct = (part:number,total:number) => total>0 ? `${(part/total*100).toLocaleString("fr-FR",{maximumFractionDigits:1})}%` : "—";
function signupSourceLabel(source:string){return ({google_ads:"Google Ads",google_organic:"Google organique",meta_ads:"Meta Ads",meta_social:"Facebook / Instagram",outreach:"E-mail outreach",direct:"Direct",referral:"Site référent",native:"Application",unknown:"Source inconnue"} as Record<string,string>)[source]??source}
function signupSourceDetail(row:RecentSignupSource){if(row.source==="unknown")return"Attribution non disponible";const parts=[row.medium&&row.medium!=="none"?row.medium:null,row.campaign].filter(Boolean);return parts.length?parts.join(" · "):"Source enregistrée"}

const GA4_KEY_EVENT_PLAN=[
 {name:"sign_up",label:"Inscription terminée",level:"Principal",detail:"Mesure les créations de compte particulier et professionnel."},
 {name:"listing_submitted",label:"Annonce soumise",level:"Principal",detail:"Mesure la soumission d’une annonce à la publication/modération."},
 {name:"purchase",label:"Achat payé",level:"Principal",detail:"Mesure un paiement marketplace confirmé, avec valeur et devise."},
 {name:"begin_checkout",label:"Paiement démarré",level:"Secondaire",detail:"Mesure le passage vers Stripe après sélection de livraison."},
 {name:"message_sent",label:"Message envoyé",level:"Secondaire",detail:"Mesure un contact réel entre acheteur et vendeur."},
 {name:"pro_trial_started",label:"Essai Pro démarré",level:"Secondaire",detail:"Mesure le démarrage d’un essai professionnel."},
] as const;

export default function AnalyticsClient() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [recovery,setRecovery]=useState<CheckoutRecovery|null>(null);
  const [recoveryBusy,setRecoveryBusy]=useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/checkout-recovery?days=${Math.min(days,90)}`, { credentials: "include", cache: "no-store" }).then(async r=>r.ok?(await r.json()) as CheckoutRecovery:null).then(payload=>{if(active)setRecovery(payload)}).catch(()=>{if(active)setRecovery(null)});
    fetch(`/api/admin/analytics/overview?days=${days}`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const payload = await r.json().catch(() => ({})) as { error?: string; message?: string };
          throw new Error(payload.message || payload.error || `analytics_http_${r.status}`);
        }
        const payload = (await r.json()) as Data;
        if (active) setData(payload);
      })
      .catch((cause) => {
        if (!active) return;
        setData(null);
        setError(cause instanceof Error ? cause.message : "analytics_unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [days, reloadKey]);

  async function runRecovery(){setRecoveryBusy(true);try{await fetch("/api/admin/checkout-recovery/run",{method:"POST",credentials:"include"});setReloadKey(v=>v+1)}finally{setRecoveryBusy(false)}}

  const max = useMemo(() => Math.max(1, ...(data?.series ?? []).map((r) => Math.max(r.newUsers, r.publishedListings, r.paidOrders))), [data]);
  const pagesPerVisit = data?.audience?.sessions ? data.audience.pageViews / data.audience.sessions : 0;
  const todayAudience = data?.dailyAudience?.[data.dailyAudience.length - 1];
  const maxAudience = useMemo(() => Math.max(1, ...(data?.dailyAudience ?? []).map((r) => r.visitors)), [data]);
  const signupTotalToday=(data?.signupSourcesToday??[]).reduce((sum,row)=>sum+row.count,0);
  const signupKnownToday=(data?.signupSourcesToday??[]).filter(row=>row.source!=="unknown").reduce((sum,row)=>sum+row.count,0);
  const signupGoogleToday=(data?.signupSourcesToday??[]).filter(row=>row.source==="google_ads"||row.source==="google_organic").reduce((sum,row)=>sum+row.count,0);
  const signupMetaToday=(data?.signupSourcesToday??[]).filter(row=>row.source==="meta_ads"||row.source==="meta_social").reduce((sum,row)=>sum+row.count,0);
  const opportunityQueries=useMemo(()=>(data?.organic?.queries??[])
    .filter(row=>!row.query.toLowerCase().startsWith("site:")&&row.position>=5&&row.position<=20&&row.impressions>=2)
    .sort((a,b)=>b.impressions-a.impressions||b.clicks-a.clicks)
    .slice(0,8),[data]);
  const organicLandings=useMemo(()=>(data?.organic?.landingPages??[]).slice(0,10),[data]);
  const gscSnapshotAgeHours=data?.organic?.gsc?.syncedAt?Math.max(0,(Date.now()-new Date(data.organic.gsc.syncedAt).getTime())/3_600_000):null;
  const gscSnapshotStale=data?.organic?.gsc?.source==="WINDSOR_SNAPSHOT"&&gscSnapshotAgeHours!==null&&gscSnapshotAgeHours>36;
  const activeGa4KeyEvents=useMemo(()=>new Set((data?.ga4?.keyEventAdmin?.events??[]).map(event=>event.eventName)),[data]);
  const organicFunnel=data?.organic?.funnel??{impressions:0,clicks:0,sessions:0,signUps:0,listingsSubmitted:0,checkoutStarts:0,purchases:0};
  const organicFunnelSteps=[
    {key:"impressions",label:"Impressions Google",value:organicFunnel.impressions,previous:0,source:"Search Console"},
    {key:"clicks",label:"Clics Google",value:organicFunnel.clicks,previous:organicFunnel.impressions,source:"Search Console"},
    {key:"sessions",label:"Sessions landing",value:organicFunnel.sessions,previous:organicFunnel.clicks,source:"Petit Annonces"},
    {key:"signups",label:"Inscriptions",value:organicFunnel.signUps,previous:organicFunnel.sessions,source:"Petit Annonces"},
    {key:"listings",label:"Annonces",value:organicFunnel.listingsSubmitted,previous:organicFunnel.signUps,source:"Petit Annonces"},
    {key:"checkouts",label:"Checkouts",value:organicFunnel.checkoutStarts,previous:organicFunnel.listingsSubmitted,source:"Petit Annonces"},
    {key:"purchases",label:"Achats payés",value:organicFunnel.purchases,previous:organicFunnel.checkoutStarts,source:"Petit Annonces"},
  ];
  const queryConversionRows=useMemo(()=>(data?.organic?.queries??[]).filter(row=>!row.query.toLowerCase().startsWith("site:")).slice(0,20),[data]);

  return <div className="admin-analytics-page">
    <div className="admin-page-head">
      <div>
        <p>Pilotage</p>
        <h1>Analytics</h1>
        <span className="subtitle">Audience consentie, acquisition et activité marketplace, avec une séparation claire entre les mesures Petit Annonces et Google Analytics 4.</span>
      </div>
      <div className="admin-analytics-head-actions">
        <select className="admin-select" aria-label="Période Analytics" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="7">7 jours</option>
          <option value="30">30 jours</option>
          <option value="90">90 jours</option>
        </select>
        <button type="button" className="admin-btn" disabled={loading} onClick={() => setReloadKey((v) => v + 1)}>{loading ? "Chargement…" : "Actualiser"}</button>
      </div>
    </div>
    {error && <div className="admin-flash err admin-analytics-error"><strong>Données Analytics indisponibles.</strong><span>{error}</span><button type="button" className="admin-btn" onClick={() => setReloadKey((v) => v + 1)}>Réessayer</button></div>}

    <section className="admin-card admin-section">
      <div className="admin-section-head">
        <div>
          <h2>Audience consentie · Petit Annonces</h2>
          <p>Données first-party mesurées directement sur le site pour la période sélectionnée. Elles ne sont pas importées depuis Google Analytics.</p>
        </div>
        <span className="admin-badge green">Source interne</span>
      </div>
      <div className="admin-grid admin-kpis">
        <article className="admin-card admin-kpi"><small>Visiteurs uniques</small><strong>{loading ? "…" : n(data?.audience?.visitors ?? 0)}</strong><p>visiteurs ayant autorisé la mesure</p></article>
        <article className="admin-card admin-kpi"><small>Visites</small><strong>{loading ? "…" : n(data?.audience?.sessions ?? 0)}</strong><p>{pagesPerVisit.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} page(s) par visite</p></article>
        <article className="admin-card admin-kpi"><small>Pages vues</small><strong>{loading ? "…" : n(data?.audience?.pageViews ?? 0)}</strong><p>sur {days} jours</p></article>
        <article className="admin-card admin-kpi"><small>Sessions PWA</small><strong>{loading ? "…" : n(data?.audience?.pwaSessions ?? 0)}</strong><p>sessions détectées en mode application</p></article>
      </div>
    </section>

    <section className="admin-card admin-section" style={{ marginTop: 16 }}>
      <div className="admin-section-head">
        <div><h2>Trafic quotidien</h2><p>Total quotidien des visiteurs mesurés, toutes sources confondues.</p></div>
      </div>
      <div className="admin-grid admin-kpis">
        <article className="admin-card admin-kpi"><small>Visiteurs aujourd’hui</small><strong>{loading ? "…" : n(todayAudience?.visitors ?? 0)}</strong><p>toutes sources confondues</p></article>
        <article className="admin-card admin-kpi"><small>Visites aujourd’hui</small><strong>{loading ? "…" : n(todayAudience?.sessions ?? 0)}</strong><p>sessions mesurées aujourd’hui</p></article>
        <article className="admin-card admin-kpi"><small>Pages aujourd’hui</small><strong>{loading ? "…" : n(todayAudience?.pageViews ?? 0)}</strong><p>pages vues aujourd’hui</p></article>
      </div>
      <div style={{ marginTop: 14 }}>
        <h3>Visiteurs par jour</h3>
        <div className="admin-mini-chart admin-analytics-chart">{(data?.dailyAudience ?? []).map((row) => <div className="admin-chart-day" key={row.d} title={`${row.d} · ${row.visitors} visiteurs`}><div className="admin-chart-bars"><i style={{ height: `${Math.max(2, row.visitors / maxAudience * 100)}%` }} /></div><small>{new Date(`${row.d}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</small></div>)}</div>
      </div>
    </section>

    <section className="admin-card admin-section" style={{ marginTop: 16 }}>
      <div className="admin-section-head">
        <div>
          <h2>Origine des inscriptions aujourd’hui</h2>
          <p>Attribution enregistrée au moment de la création du compte, indépendante de Google Analytics.</p>
        </div>
        <span className="admin-badge green">Source inscription</span>
      </div>
      <div className="admin-grid admin-kpis">
        <article className="admin-card admin-kpi"><small>Nouveaux membres</small><strong>{loading?"…":n(signupTotalToday)}</strong><p>créés aujourd’hui</p></article>
        <article className="admin-card admin-kpi"><small>Source identifiée</small><strong>{loading?"…":n(signupKnownToday)}</strong><p>{signupTotalToday?Math.round(signupKnownToday/signupTotalToday*100):0}% des inscriptions du jour</p></article>
        <article className="admin-card admin-kpi"><small>Google</small><strong>{loading?"…":n(signupGoogleToday)}</strong><p>Ads et organique séparés ci-dessous</p></article>
        <article className="admin-card admin-kpi"><small>Meta</small><strong>{loading?"…":n(signupMetaToday)}</strong><p>publicité et social séparés ci-dessous</p></article>
      </div>
      <div className="admin-grid admin-two-col" style={{ marginTop: 14 }}>
        <div>
          <h3>Répartition par source</h3>
          <div className="admin-stack-list">{(data?.signupSourcesToday??[]).length?(data?.signupSourcesToday??[]).map(row=><div className="admin-order-row admin-analytics-row" key={row.source}><div><strong>{signupSourceLabel(row.source)}</strong><small>{row.source==="google_ads"?"Trafic Google explicitement payant":row.source==="meta_ads"?"Trafic Meta explicitement payant":row.source==="unknown"?"Aucun signal fiable enregistré":"Attribution d’inscription"}</small></div><b>{n(row.count)}</b></div>):<div className="admin-card" style={{padding:14}}>Aucune inscription aujourd’hui.</div>}</div>
        </div>
        <div>
          <h3>Dernières inscriptions</h3>
          <div className="admin-stack-list">{(data?.recentSignupSourcesToday??[]).length?(data?.recentSignupSourcesToday??[]).map((row,index)=><div className="admin-order-row admin-analytics-row" key={`${row.createdAt}-${index}`}><div><strong>{new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(new Date(row.createdAt))} · {row.kind==="PROFESSIONNEL"?"Professionnel":"Particulier"}</strong><small>{signupSourceLabel(row.source)} · {signupSourceDetail(row)}{row.landingPath?` · ${row.landingPath}`:""}</small></div><span className={`admin-badge ${row.source==="unknown"?"orange":"green"}`}>{signupSourceLabel(row.source)}</span></div>):<div className="admin-card" style={{padding:14}}>Aucune inscription aujourd’hui.</div>}</div>
        </div>
      </div>
      <p style={{margin:"14px 0 0",color:"var(--muted)",fontSize:12}}>Google Ads n’est compté que lorsqu’un signal payant est présent (par exemple CPC). Un lien Facebook avec simple provenance sociale reste classé Facebook / Instagram et non Meta Ads. Les identifiants publicitaires complets ne sont pas conservés dans ce rapport.</p>
    </section>

    <section className="admin-card admin-section" style={{ marginTop: 16 }}>
      <div className="admin-section-head">
        <div>
          <h2>Google Analytics 4</h2>
          <p>Collecte Google + lecture des rapports via GA4 Data API.</p>
        </div>
        <span className={`admin-badge ${data?.ga4?.reportingConnected ? "green" : "orange"}`}>{data?.ga4?.reportingConnected ? "Rapports connectés" : "Connexion à terminer"}</span>
      </div>
      <div className="admin-home-ga4">
        <div className="admin-home-ga4-head admin-analytics-ga4-head"><div><small>Measurement ID</small><strong>{data?.ga4?.measurementId ?? "G-H1WZ5519J1"}</strong></div><div><small>Property ID</small><strong>{data?.ga4?.propertyId ?? "—"}</strong></div></div>
        {data?.ga4?.connected ? <>
          <div className="admin-grid admin-kpis" style={{ marginTop: 14 }}>
            <article className="admin-card admin-kpi"><small>Utilisateurs actifs GA4</small><strong>{n(data.ga4.activeUsers)}</strong><p>{n(data.ga4.totalUsers)} utilisateurs au total</p></article>
            <article className="admin-card admin-kpi"><small>Sessions GA4</small><strong>{n(data.ga4.sessions)}</strong><p>{n(data.ga4.newUsers)} nouveaux utilisateurs</p></article>
            <article className="admin-card admin-kpi"><small>Pages vues GA4</small><strong>{n(data.ga4.pageViews)}</strong><p>{n(data.ga4.eventCount)} événements</p></article>
            <article className="admin-card admin-kpi"><small>Taux d’engagement</small><strong>{Math.round((data.ga4.engagementRate ?? 0) * 100)}%</strong><p>{n(data.ga4.keyEvents)} événement(s) clé(s)</p></article>
          </div>
          <div className="admin-grid admin-two-col" style={{ marginTop: 14 }}>
            <div><h3>Canaux GA4</h3><div className="admin-stack-list">{data.ga4.channels.map((r) => <div className="admin-order-row admin-analytics-row" key={r.name}><div><strong>{r.name}</strong><small>{n(r.users)} utilisateur(s)</small></div><b>{n(r.sessions)} sessions</b></div>)}</div></div>
            <div><h3>Pages GA4</h3><div className="admin-stack-list">{data.ga4.pages.map((r) => <div className="admin-order-row admin-analytics-row" key={r.path}><div><strong>{r.path}</strong><small>{n(r.users)} utilisateur(s)</small></div><b>{n(r.views)} vues</b></div>)}</div></div>
          </div>
        </> : <div className="admin-card" style={{ marginTop: 14, padding: 16 }}>
          <strong>{data?.ga4?.errorCode === "api_disabled" ? "Google Analytics Data API doit être activée" : data?.ga4?.errorCode === "permission_missing" ? "Accès GA4 du compte de service requis" : "Rapports GA4 indisponibles"}</strong>
          <p style={{ margin: "6px 0", color: "var(--muted)" }}>{data?.ga4?.errorMessage ?? "La balise web est configurée, mais la lecture des rapports n’est pas encore disponible."}</p>
          {data?.ga4?.serviceAccountEmail && <code>{data.ga4.serviceAccountEmail}</code>}
        </div>}
        <p>La collecte web utilise le consentement Analytics. Les données first-party ci-dessus restent indépendantes de Google.</p>
        <div className="admin-home-ga4-status"><span className={`admin-badge ${data?.ga4?.reportingConnected ? "green" : "orange"}`}>{data?.ga4?.reportingConnected ? "GA4 Data API active" : "Action Google requise"}</span><a href="https://analytics.google.com/analytics/web/" target="_blank" rel="noreferrer">Ouvrir Google Analytics</a></div>
        {data?.ga4?.errorCode === "permission_missing" && <div className="admin-card" style={{marginTop:14,padding:16,borderStyle:"dashed"}}>
          <strong>Autorisation GA4 du compte de service requise</strong>
          <p style={{margin:"6px 0",color:"var(--muted)"}}>Dans GA4, propriété <b>{data.ga4.propertyId ?? "515794319"}</b> → Administration → Gestion des accès à la propriété, ajoutez le compte ci-dessous avec le rôle <b>Marketer</b>. Ce rôle suffit pour lire les rapports et gérer les événements clés sans donner le rôle Administrateur.</p>
          {data.ga4.serviceAccountEmail && <code style={{display:"block",overflowWrap:"anywhere"}}>{data.ga4.serviceAccountEmail}</code>}
        </div>}
        <div style={{marginTop:18}}>
          <div className="admin-section-head"><div><h3>Plan des événements clés GA4</h3><p>Instrumentation Petit Annonces + état réel lu via Google Analytics Admin API. Les principaux servent aux conversions métier; les secondaires au diagnostic du tunnel.</p></div><span className={`admin-badge ${data?.ga4?.keyEventAdmin?.connected?"green":"orange"}`}>{data?.ga4?.keyEventAdmin?.connected?"Admin API active":"État non vérifié"}</span></div>
          <div className="admin-stack-list">{GA4_KEY_EVENT_PLAN.map(item=>{const active=activeGa4KeyEvents.has(item.name);return <div className="admin-order-row admin-analytics-row" key={item.name}><div><strong>{item.label}</strong><small><code>{item.name}</code> · {item.detail}</small></div><span className={`admin-badge ${active?"green":"orange"}`}>{active?"Key Event actif":item.level==="Principal"?"Key Event manquant":"Secondaire"}</span></div>})}</div>
        </div>
      </div>
    </section>

    <section className="admin-card admin-section" style={{ marginTop: 16 }}>
      <div className="admin-section-head">
        <div>
          <h2>Acquisition organique · Google</h2>
          <p>Search Console pour la visibilité et les clics, GA4 pour les sessions et les conversions issues de la recherche organique.</p>
        </div>
        <span className={`admin-badge ${data?.organic?.gsc?.connected&&!gscSnapshotStale&&data?.organic?.ga4?.connected?"green":"orange"}`}>
          {data?.organic?.gsc?.source==="WINDSOR_SNAPSHOT"?(gscSnapshotStale?"Snapshot à actualiser":"Search Console · Windsor"):data?.organic?.gsc?.source==="GOOGLE_API"?"Search Console API":"Connexion partielle"}
        </span>
      </div>
      {data?.organic?.gsc?.connected ? <>
        <div className="organic-funnel-panel">
          <div className="organic-funnel-head">
            <div><h3>Google → landing page → conversion</h3><p>Chaîne unifiée Search Console + mesure Petit Annonces. Les conversions sont rattachées à la première landing organique Google connue de l’utilisateur dans la période.</p></div>
            <div className="organic-source-badges"><span className="admin-badge green">Search Console LIVE</span><span className="admin-badge">GA4 {n(data.organic.ga4.sessions)} sessions</span><span className="admin-badge">PA {n(data.organic.firstParty.sessions)} sessions</span></div>
          </div>
          <div className="organic-funnel-steps">{organicFunnelSteps.map((step,index)=><article className="organic-funnel-step" key={step.key}><small>{step.source}</small><strong>{n(step.value)}</strong><span>{step.label}</span>{index>0&&<em>{pct(step.value,step.previous)} de l’étape précédente</em>}</article>)}</div>
          <div className="organic-funnel-summary">
            <span><b>{pct(organicFunnel.clicks,organicFunnel.impressions)}</b> impression → clic</span>
            <span><b>{pct(organicFunnel.signUps,organicFunnel.sessions)}</b> session → inscription</span>
            <span><b>{pct(organicFunnel.listingsSubmitted,organicFunnel.signUps)}</b> inscription → annonce</span>
            <span><b>{pct(organicFunnel.purchases,organicFunnel.checkoutStarts)}</b> checkout → achat</span>
          </div>
        </div>
        <div className="admin-card organic-query-chain" style={{marginTop:14,padding:0,overflow:"hidden"}}>
          <div className="admin-section-head" style={{padding:"16px 16px 0"}}><div><h3>Requête Google → landing → résultat</h3><p>Les métriques après le clic sont celles de la landing page correspondante, pas d’un utilisateur identifié par requête.</p></div><span className="admin-badge">{queryConversionRows.length} lignes</span></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Requête</th><th>Landing page</th><th>Impr.</th><th>Clics</th><th>Pos.</th><th>Sessions</th><th>Inscr.</th><th>Annonces</th><th>Checkouts</th><th>Achats</th></tr></thead><tbody>{queryConversionRows.map((row,index)=><tr key={`${row.query}-${row.page}-chain-${index}`}><td><strong>{row.query}</strong></td><td><small>{row.page}</small></td><td>{n(row.impressions)}</td><td><strong>{n(row.clicks)}</strong></td><td>{row.position.toLocaleString("fr-FR",{maximumFractionDigits:1})}</td><td>{n(row.landingMetrics?.sessions??0)}</td><td>{n(row.landingMetrics?.signUps??0)}</td><td>{n(row.landingMetrics?.listingsSubmitted??0)}</td><td>{n(row.landingMetrics?.checkoutStarts??0)}</td><td>{n(row.landingMetrics?.purchases??0)}</td></tr>)}{!queryConversionRows.length&&<tr><td colSpan={10}><div className="admin-empty">Aucune requête Search Console sur cette période.</div></td></tr>}</tbody></table></div>
        </div>
        <div className="admin-grid admin-kpis" style={{marginTop:14}}>
          <article className="admin-card admin-kpi"><small>Impressions Google</small><strong>{n(data.organic.funnel.impressions)}</strong><p>position moyenne {data.organic.gsc.position?data.organic.gsc.position.toLocaleString("fr-FR",{maximumFractionDigits:1}):"—"}</p></article>
          <article className="admin-card admin-kpi"><small>Clics Google</small><strong>{n(data.organic.funnel.clicks)}</strong><p>CTR {(data.organic.gsc.ctr*100).toLocaleString("fr-FR",{maximumFractionDigits:1})}%</p></article>
          <article className="admin-card admin-kpi"><small>Sessions organiques</small><strong>{n(data.organic.funnel.sessions)}</strong><p>sessions Google organiques attribuées par Petit Annonces</p></article>
          <article className="admin-card admin-kpi"><small>Inscriptions</small><strong>{n(data.organic.funnel.signUps)}</strong><p>comptes reliés à une landing organique Google</p></article>
          <article className="admin-card admin-kpi"><small>Annonces soumises</small><strong>{n(data.organic.funnel.listingsSubmitted)}</strong><p>annonces créées après acquisition organique attribuée</p></article>
          <article className="admin-card admin-kpi"><small>Achats</small><strong>{n(data.organic.funnel.purchases)}</strong><p>{n(data.organic.funnel.checkoutStarts)} paiement(s) démarré(s)</p></article>
        </div>
        <p style={{margin:"12px 0 0",color:"var(--muted)",fontSize:12}}>
          Période Search Console : {data.organic.gsc.startDate??"—"} → {data.organic.gsc.endDate??"—"}
          {data.organic.gsc.syncedAt?` · dernière synchro ${new Date(data.organic.gsc.syncedAt).toLocaleString("fr-FR")}`:""}.
        </p>
        <div className="admin-grid admin-two-col" style={{marginTop:16}}>
          <div>
            <h3>Opportunités entre les positions 5 et 20</h3>
            <div className="admin-stack-list">{opportunityQueries.length?opportunityQueries.map((row,index)=><div className="admin-order-row admin-analytics-row" key={`${row.query}-${row.page}-${index}`}><div style={{minWidth:0}}><strong style={{overflowWrap:"anywhere"}}>{row.query}</strong><small style={{overflowWrap:"anywhere"}}>{row.page} · position {row.position.toLocaleString("fr-FR",{maximumFractionDigits:1})} · {n(row.impressions)} impression(s){row.landingMetrics?` · ${n(row.landingMetrics.sessions)} session(s) landing`:""}</small></div><b>{n(row.clicks)} clic(s)</b></div>):<div className="admin-card" style={{padding:14}}>Aucune requête qualifiée dans la fenêtre sélectionnée.</div>}</div>
          </div>
          <div>
            <h3>Landing pages organiques</h3>
            <div className="admin-stack-list">{organicLandings.length?organicLandings.map(row=><div className="admin-order-row admin-analytics-row" key={row.path}><div style={{minWidth:0}}><strong style={{overflowWrap:"anywhere"}}>{row.path}</strong><small>{n(row.clicks)} clic(s) GSC · {n(row.sessions)} session(s) GA4{row.position?` · pos. ${row.position.toLocaleString("fr-FR",{maximumFractionDigits:1})}`:""}</small></div><b>{n(row.signUps)} inscr. · {n(row.listingsSubmitted)} annonce(s) · {n(row.purchases)} achat(s)</b></div>):<div className="admin-card" style={{padding:14}}>Aucune landing page organique mesurée.</div>}</div>
          </div>
        </div>
        <div className="admin-card" style={{marginTop:14,padding:14,borderStyle:"dashed"}}>
          <strong>Méthodologie</strong>
          <p style={{margin:"6px 0 0",color:"var(--muted)",fontSize:12}}>Un clic Search Console et une session GA4 ne sont pas la même mesure et ne doivent pas être attendus à l’identique. Les conversions affichées à côté d’une requête correspondent aux conversions agrégées de sa landing page ; elles ne constituent pas une attribution individuelle à cette requête. Les lignes Search Console affichées sont un échantillon des meilleures lignes, tandis que les KPI utilisent les totaux complets.</p>
        </div>
      </> : <div className="admin-card" style={{padding:16}}><strong>Search Console indisponible</strong><p style={{margin:"6px 0",color:"var(--muted)"}}>{data?.organic?.gsc?.errorMessage??"Aucune donnée Search Console n’est disponible pour cette période."}</p></div>}
    </section>

    <section className="admin-card admin-section checkout-recovery-panel" style={{marginTop:16}}>
      <div className="admin-section-head">
        <div><h2>Récupération des checkouts abandonnés</h2><p>Rappel automatique après {recovery?.config.firstDelayMinutes??30} min, second rappel après {recovery?.config.secondDelayHours??24} h, puis fermeture automatique après {recovery?.config.expireDelayHours??72} h si le paiement n’est toujours pas confirmé.</p></div>
        <div className="admin-analytics-head-actions"><span className="admin-badge green">Hostinger Mail</span><button type="button" className="admin-btn" disabled={recoveryBusy} onClick={()=>void runRecovery()}>{recoveryBusy?"Contrôle…":"Contrôler maintenant"}</button></div>
      </div>
      <div className="admin-grid admin-kpis">
        <article className="admin-card admin-kpi"><small>Checkouts abandonnés</small><strong>{n(recovery?.summary.abandoned??0)}</strong><p>paiements non confirmés depuis au moins 30 min</p></article>
        <article className="admin-card admin-kpi"><small>Rappels déclenchés</small><strong>{n((recovery?.summary.firstReminders??0)+(recovery?.summary.secondReminders??0))}</strong><p>{n(recovery?.summary.firstReminders??0)} premier(s) · {n(recovery?.summary.secondReminders??0)} second(s)</p></article>
        <article className="admin-card admin-kpi"><small>Achats récupérés</small><strong>{n(recovery?.summary.recovered??0)}</strong><p>commande payée après un rappel</p></article>
        <article className="admin-card admin-kpi"><small>GMV récupéré</small><strong>{euro(recovery?.summary.recoveredGmvMinor??0)}</strong><p>ventes confirmées après relance</p></article>
      </div>
      <div className="admin-card organic-query-chain" style={{marginTop:14,padding:0,overflow:"hidden"}}>
        <div className="admin-section-head" style={{padding:"16px 16px 0"}}><div><h3>Derniers checkouts suivis</h3><p>Les rappels respectent les préférences de notification de l’utilisateur. Aucun rappel n’est envoyé après paiement.</p></div><span className="admin-badge">{n(recovery?.items.length??0)} suivi(s)</span></div>
        <div className="admin-table-wrap"><table className="admin-table checkout-recovery-table"><thead><tr><th>Commande</th><th>Annonce</th><th>Montant</th><th>Provider</th><th>Statut</th><th>Rappel 30 min</th><th>Rappel 24 h</th><th>Créée</th></tr></thead><tbody>{(recovery?.items??[]).map(row=><tr key={row.id}><td><strong>{row.orderNumber}</strong></td><td><small>{row.title??"Annonce"}</small></td><td>{money(row.totalAmountMinor,row.currency)}</td><td>{row.paymentProvider==="paypal"?"PayPal":row.paymentProvider==="stripe-connect"?"Carte / Stripe":row.paymentProvider??"—"}</td><td><span className={`admin-badge ${row.status==="PAID"?"green":row.status==="PENDING_PAYMENT"?"orange":""}`}>{row.status==="PAID"?"Récupéré":row.status==="PENDING_PAYMENT"?"En attente":row.status}</span></td><td>{row.firstReminderAt?new Date(row.firstReminderAt).toLocaleString("fr-FR"):"—"}</td><td>{row.secondReminderAt?new Date(row.secondReminderAt).toLocaleString("fr-FR"):"—"}</td><td>{new Date(row.createdAt).toLocaleString("fr-FR")}</td></tr>)}{!(recovery?.items??[]).length&&<tr><td colSpan={8}><div className="admin-empty">Aucun checkout abandonné à récupérer pour le moment.</div></td></tr>}</tbody></table></div>
      </div>
    </section>

    <div className="admin-section-head" style={{ marginTop: 22 }}><div><h2>Activité marketplace</h2><p>Ces indicateurs proviennent directement de la base Petit Annonces.</p></div></div>
    <div className="admin-grid admin-kpis">
      <article className="admin-card admin-kpi"><small>Nouveaux utilisateurs</small><strong>{loading ? "…" : data?.summary.newUsers ?? 0}</strong><p>sur {days} jours</p></article>
      <article className="admin-card admin-kpi"><small>Annonces publiées</small><strong>{loading ? "…" : data?.summary.publishedListings ?? 0}</strong><p>{data?.summary.newListings ?? 0} nouvelles annonces créées</p></article>
      <article className="admin-card admin-kpi"><small>Commandes payées</small><strong>{loading ? "…" : data?.summary.paidOrders ?? 0}</strong><p>{data?.summary.orders ?? 0} commandes créées</p></article>
      <article className="admin-card admin-kpi"><small>GMV / revenus</small><strong>{data ? euro(data.summary.gmvMinor) : "—"}</strong><p>{data ? euro(data.summary.revenueMinor) : "—"} revenus plateforme</p></article>
    </div>

    <div className="admin-grid admin-two-col" style={{ marginTop: 16 }}>
      <section className="admin-card admin-section">
        <div className="admin-section-head"><div><h2>Activité quotidienne</h2><p>Utilisateurs, annonces publiées et commandes payées.</p></div></div>
        <div className="admin-mini-chart admin-analytics-chart">{(data?.series ?? []).map((row) => <div className="admin-chart-day" key={row.d} title={`${row.d} · ${row.newUsers} utilisateurs · ${row.publishedListings} annonces · ${row.paidOrders} commandes`}><div className="admin-chart-bars"><i style={{ height: `${Math.max(2, row.newUsers / max * 100)}%` }} /><i style={{ height: `${Math.max(2, row.publishedListings / max * 100)}%` }} /><i style={{ height: `${Math.max(2, row.paidOrders / max * 100)}%` }} /></div><small>{new Date(`${row.d}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</small></div>)}</div>
        <div className="admin-chart-legend"><span><i /> Utilisateurs</span><span><i /> Annonces publiées</span><span><i /> Commandes payées</span></div>
      </section>
      <aside className="admin-card admin-section">
        <div className="admin-section-head"><div><h2>Qualité opérationnelle</h2><p>Signaux sur la période choisie.</p></div></div>
        <div className="admin-stack-list"><div className="admin-order-row"><span className="admin-drag-index">!</span><div><strong>Litiges ouverts</strong><small>Créés pendant la période</small></div><b>{data?.summary.disputes ?? 0}</b></div><div className="admin-order-row"><span className="admin-drag-index">✉</span><div><strong>Tickets support</strong><small>Créés pendant la période</small></div><b>{data?.summary.supportTickets ?? 0}</b></div></div>
      </aside>
    </div>

    <div className="admin-grid admin-two-col" style={{ marginTop: 16 }}>
      <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>État des annonces</h2><p>Distribution actuelle du catalogue.</p></div></div><div className="admin-stack-list">{(data?.listingStatuses ?? []).map((r) => <div className="admin-order-row" key={r.status}><span className="admin-drag-index">▤</span><div><strong>{r.status}</strong><small>Statut marketplace</small></div><b>{r.count}</b></div>)}</div></section>
      <section className="admin-card admin-section"><div className="admin-section-head"><div><h2>Types de comptes</h2><p>Particuliers et professionnels.</p></div></div><div className="admin-stack-list">{(data?.userKinds ?? []).map((r) => <div className="admin-order-row" key={r.kind}><span className="admin-drag-index">◎</span><div><strong>{r.kind}</strong><small>Type utilisateur</small></div><b>{r.count}</b></div>)}</div></section>
    </div>
  </div>;
}
