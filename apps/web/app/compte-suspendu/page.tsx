import type { Metadata } from "next";
import { SuspendedAccountClient } from "./suspended-account-client";

export const metadata:Metadata={title:"Compte temporairement suspendu | Petit Annonces",robots:{index:false,follow:false}};

export default function SuspendedAccountPage(){return <SuspendedAccountClient/>}
