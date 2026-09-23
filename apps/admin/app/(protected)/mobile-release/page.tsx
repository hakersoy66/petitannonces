import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import MobileReleaseClient from "./mobile-release-client";

export const metadata = { title: "Application mobile" };

type Me = { user?: { roles?: string[] } };
async function requireSuperAdmin() {
  const store = await cookies();
  const token = store.get("pa_session")?.value;
  if (!token) redirect("/connexion");
  const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/auth/me`, { headers: { cookie: `pa_session=${encodeURIComponent(token)}` }, cache: "no-store" });
    if (!r.ok) redirect("/");
    const payload = await r.json() as Me;
    if (!(payload.user?.roles ?? []).includes("SUPER_ADMIN")) redirect("/");
  } catch { redirect("/"); }
}

export default async function MobileReleasePage() {
  await requireSuperAdmin();
  return <MobileReleaseClient />;
}
