import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "../../components/admin-shell";
const ADMIN_ROLES=new Set(["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"]);
type Me={user?:{email?:string;roles?:string[];profile?:{displayName?:string|null;firstName?:string|null;lastName?:string|null}|null}};
async function adminUser(){const store=await cookies();const token=store.get("pa_session")?.value;if(!token)return null;try{const base=process.env.API_INTERNAL_URL??"http://127.0.0.1:4000";const r=await fetch(`${base.replace(/\/$/,"")}/auth/me`,{headers:{cookie:`pa_session=${encodeURIComponent(token)}`},cache:"no-store"});if(!r.ok)return null;const p=await r.json() as Me;const roles=p.user?.roles??[];if(!roles.some(role=>ADMIN_ROLES.has(role)))return null;const profile=p.user?.profile;const name=profile?.displayName??[profile?.firstName,profile?.lastName].filter(Boolean).join(" ")??"Administrateur";return{email:p.user?.email??"",name:name||"Administrateur",roles}}catch{return null}}
export default async function ProtectedAdminLayout({children}:{children:ReactNode}){const user=await adminUser();if(!user)redirect("/connexion");return <AdminShell user={user}>{children}</AdminShell>}