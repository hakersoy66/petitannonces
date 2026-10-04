import type { Metadata } from 'next';
import PortalClient from './portal-client';
export const metadata:Metadata={title:'Espace créateur & collaborations',description:'Consultez vos propositions, accords, justificatifs et suivis de paiement Petit Annonces.',robots:{index:false,follow:false}};
export default function Page(){return <PortalClient/>;}
