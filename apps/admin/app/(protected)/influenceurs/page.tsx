import InfluenceursClient from './influenceurs-client';
import ApplicationsPanel from './applications-panel';
import WorkflowPanel from './workflow-panel';
export const metadata = { title: 'Influenceurs & Partenariats · Petit Annonces' };
export default function Page() { return <><ApplicationsPanel /><WorkflowPanel /><InfluenceursClient /></>; }
