import type {Metadata} from "next";
import type {ReactNode} from "react";
import {AuthAreaGuard} from "../../components/auth-area-guard";
import "./pro-responsive.css";

export const metadata:Metadata={robots:{index:false,follow:true}};

export default function Layout({children}:{children:ReactNode}){
 return <AuthAreaGuard area="professional"><div className="pa-pro-area">{children}</div></AuthAreaGuard>;
}
