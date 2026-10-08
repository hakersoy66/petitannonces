import type { AdminIconName } from "../components/admin-icon";

export type AdminNavItem={icon:AdminIconName;label:string;href:string;roles?:readonly string[]};
export type AdminNavGroup={label:string;items:AdminNavItem[]};

const top=["SUPER_ADMIN","ADMIN"] as const;
const moderation=[...top,"MODERATOR","SUPPORT","COMPLIANCE"];
const marketing=[...top,"MARKETING"];
const finance=[...top,"FINANCE"];
const campaigns=[...top,"MARKETING","FINANCE"];
const operations=[...top,"SUPPORT","MODERATOR","COMPLIANCE"];
const notifications=[...top,"MARKETING","SUPPORT"];
const fulfillment=[...top,"MARKETING","COMPLIANCE"];

export const adminNavGroups:AdminNavGroup[]=[
 {label:"Pilotage",items:[
  {icon:"dashboard",label:"Tableau de bord",href:"/"},
  {icon:"shield",label:"Modération",href:"/moderation",roles:moderation},
  {icon:"list",label:"Annonces",href:"/listings",roles:[...top,"MODERATOR","SUPPORT"]},
  {icon:"users",label:"Utilisateurs",href:"/users",roles:[...top,"SUPPORT","COMPLIANCE"]},
  {icon:"support",label:"Support",href:"/support",roles:[...top,"SUPPORT"]},
  {icon:"chart",label:"Analytics",href:"/analytics"},
 ]},
 {label:"Sécurité & conformité",items:[
  {icon:"shield",label:"Signalements DSA",href:"/dsa",roles:[...top,"MODERATOR","COMPLIANCE"]},
  {icon:"users",label:"Utilisateurs bloqués",href:"/blocked-users",roles:moderation},
  {icon:"shield",label:"Centre de risque",href:"/risk",roles:moderation},
  {icon:"chart",label:"Santé de la marketplace",href:"/marketplace-health"},
  {icon:"list",label:"Santé des imports",href:"/imports",roles:[...top,"MARKETING","MODERATOR","SUPPORT"]},
 ]},
 {label:"Ventes & opérations",items:[
  {icon:"store",label:"Professionnels & vitrines",href:"/professionals",roles:[...top,"SUPPORT","COMPLIANCE"]},
  {icon:"wallet",label:"Finance",href:"/finance",roles:[...finance,"SUPPORT"]},
  {icon:"briefcase",label:"Réservations HBX",href:"/hbx-bookings",roles:[...top,"SUPPORT","FINANCE"]},
  {icon:"store",label:"Fournisseurs & produits neufs",href:"/suppliers",roles:fulfillment},
  {icon:"bell",label:"Boîte e-mail",href:"/inbox",roles:[...top,"SUPPORT"]},
 ]},
 {label:"Marketing & croissance",items:[
  {icon:"growth",label:"Croissance",href:"/growth",roles:campaigns},
  {icon:"campaign",label:"Influenceurs & partenariats",href:"/influenceurs",roles:marketing},
  {icon:"search",label:"SEO & Google",href:"/seo",roles:marketing},
  {icon:"briefcase",label:"Suivi Emploi",href:"/emploi-analytics",roles:operations},
  {icon:"campaign",label:"Offres & campagnes",href:"/commercial",roles:campaigns},
 ]},
 {label:"Configuration",items:[
  {icon:"categories",label:"Catégories",href:"/categories",roles:top},
  {icon:"content",label:"Navigation & contenu",href:"/content",roles:marketing},
  {icon:"bell",label:"E-mails & notifications",href:"/notifications",roles:notifications},
  {icon:"settings",label:"Site & Apparence",href:"/settings",roles:marketing},
  {icon:"plug",label:"Intégrations & API",href:"/integrations",roles:top},
  {icon:"server",label:"Interface application",href:"/mobile-ui",roles:["SUPER_ADMIN"]},
  {icon:"server",label:"Publication Android",href:"/mobile-release",roles:["SUPER_ADMIN"]},
  {icon:"server",label:"État du système",href:"/system",roles:top},
  {icon:"audit",label:"Journal admin",href:"/audit",roles:top},
 ]},
];

export function visibleAdminGroups(userRoles:readonly string[]):AdminNavGroup[]{
 return adminNavGroups.map(group=>({...group,items:group.items.filter(item=>!item.roles||item.roles.some(role=>userRoles.includes(role)))})).filter(group=>group.items.length>0);
}
export function adminPathActive(path:string,href:string){return href==="/"?path==="/":path===href||path.startsWith(href+"/");}
export function adminCurrentItem(path:string,groups:AdminNavGroup[]):AdminNavItem|undefined{
 return groups.flatMap(group=>group.items).filter(item=>adminPathActive(path,item.href)).sort((a,b)=>b.href.length-a.href.length)[0];
}
export function adminSearchMatch(label:string,query:string):boolean{
 const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
 return normalize(label).includes(normalize(query));
}
