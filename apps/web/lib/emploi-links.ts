export type EmploiFilters={q:string;departement:string;contrat:""|"CDI"|"CDD"|"MIS";page:number};
export function emploiHref(filters:Partial<EmploiFilters>):string{
 const search=new URLSearchParams();
 if(filters.q)search.set("ft_q",filters.q);
 if(filters.departement)search.set("ft_dept",filters.departement);
 if(filters.contrat)search.set("ft_contract",filters.contrat);
 if(filters.page&&filters.page>1)search.set("ft_page",String(filters.page));
 const query=search.toString();
 return "/categorie/emploi"+(query?"?"+query:"")+"#offres-officielles";
}
