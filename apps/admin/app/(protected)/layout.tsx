import { adminServerFetch } from "../../lib/server-api";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "../../components/admin-shell";
const ADMIN_ROLES=new Set(["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"]);
type Me={user?:{email?:string;roles?:string[];profile?:{displayName?:string|null;firstName?:string|null;lastName?:string|null}|null}};
async function adminUser(){const p=await adminServerFetch<Me>("/auth/me");if(!p)return null;const roles=p.user?.roles??[];if(!roles.some(role=>ADMIN_ROLES.has(role)))return null;const profile=p.user?.profile;const name=profile?.displayName??[profile?.firstName,profile?.lastName].filter(Boolean).join(" ");return{email:p.user?.email??"",name:name||"Administrateur",roles}}
export default async function ProtectedAdminLayout({children}:{children:ReactNode}){const user=await adminUser();if(!user)redirect("/connexion");return <AdminShell user={user}>{children}</AdminShell>}
