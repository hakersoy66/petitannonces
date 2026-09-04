import type { Metadata } from "next";

export const metadata: Metadata = { title: "Petit Annonces Admin" };

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body></html>;
}
