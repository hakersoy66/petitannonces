import type {Metadata} from "next";
import type {ReactNode} from "react";
import {AuthAreaGuard} from "../../components/auth-area-guard";
import "./pro-responsive.css";

export const metadata:Metadata={robots:{index:false,follow:true}};

export default function Layout({children}:{children:ReactNode}){
 return <AuthAreaGuard area="professional"><div className="pa-pro-area">{children}</div></AuthAreaGuard>;
}

[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]