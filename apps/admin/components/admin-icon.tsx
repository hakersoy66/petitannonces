import type { SVGProps } from "react";

export type AdminIconName =
  | "dashboard" | "shield" | "list" | "users" | "store" | "wallet" | "support"
  | "chart" | "growth" | "compliance" | "categories" | "content" | "campaign"
  | "bell" | "settings" | "plug" | "server" | "audit" | "external" | "menu"
  | "logout" | "edit" | "plus" | "search" | "check" | "clock" | "credit-card"
  | "briefcase" | "message" | "warning";

const paths: Record<AdminIconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  shield: <><path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  store: <><path d="M3 9 5 3h14l2 6"/><path d="M5 13v8h14v-8"/><path d="M9 21v-6h6v6"/><path d="M3 9c0 2 3 3 4.5 1.5C9 12 12 12 13.5 10.5 15 12 18 12 21 9"/></>,
  wallet: <><path d="M3 6h15a3 3 0 0 1 3 3v9H5a2 2 0 0 1-2-2V6Z"/><path d="M3 6a3 3 0 0 1 3-3h11"/><path d="M16 12h5"/></>,
  support: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-5a7 7 0 0 1-1-4V8a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v7Z"/><path d="M8 9h8M8 13h5"/></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  growth: <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>,
  compliance: <><path d="M12 3v18M5 7h14"/><path d="m5 7-3 6h6L5 7ZM19 7l-3 6h6l-3-6Z"/><path d="M8 21h8"/></>,
  categories: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
  content: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></>,
  campaign: <><path d="m3 11 15-6v14L3 13v-2Z"/><path d="M7 14v5a2 2 0 0 0 2 2h1"/><path d="M18 9a3 3 0 0 1 0 6"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  plug: <><path d="M12 22v-5M9 8V2M15 8V2"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z"/></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h7M11 17h7"/></>,
  audit: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  "credit-card": <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"/></>,
  message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-5a7 7 0 0 1-1-4V8a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v7Z"/></>,
  warning: <><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5M12 18h.01"/></>,
};

export function AdminIcon({name,className,...props}:{name:AdminIconName;className?:string}&Omit<SVGProps<SVGSVGElement>,"name">){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>{paths[name]}</svg>;
}
