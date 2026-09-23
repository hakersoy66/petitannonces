import type { Metadata } from "next";
import "./admin.css";
export const metadata: Metadata = { title: { default:"Petit Annonces Admin", template:"%s | Petit Annonces Admin" }, robots:{index:false,follow:false} };
export default function AdminLayout({children}:{children:React.ReactNode}){return <html lang="fr"><body>{children}</body></html>}
