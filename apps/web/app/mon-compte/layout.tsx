import type {Metadata} from "next";
import type {ReactNode} from "react";
import {AuthAreaGuard} from "../../components/auth-area-guard";
import "./account-responsive.css";

export const metadata:Metadata={robots:{index:false,follow:true}};

export default function AccountLayout({children}:{children:ReactNode}){
 return <AuthAreaGuard area="account"><div className="pa-account-area">{children}</div></AuthAreaGuard>;
}