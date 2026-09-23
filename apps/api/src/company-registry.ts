type PublicCompany = {
  siren:string; siret:string|null; legalName:string; tradeName:string|null; nafCode:string|null; legalFormCode:string|null; headquartersAddress:string|null; headquartersPostalCode:string|null; headquartersCity:string|null; active:boolean; source:string; reference:string;
};
function digits(v:string){return v.replace(/\D/g,"")}
export async function lookupPublicCompany(identifier:string):Promise<PublicCompany|null>{
  const id=digits(identifier); if(![9,14].includes(id.length)) return null;
  const u=new URL("https://recherche-entreprises.api.gouv.fr/search"); u.searchParams.set("q",id); u.searchParams.set("per_page","5");
  const r=await fetch(u,{headers:{accept:"application/json","user-agent":"PetitAnnonces/1.0"},signal:AbortSignal.timeout(8000)}); if(!r.ok) throw new Error(`public_registry_${r.status}`);
  const data=await r.json() as {results?:Array<Record<string,any>>};
  const rows=data.results??[];
  const company=rows.find(x=>String(x.siren??"")===id.slice(0,9) && (id.length===9 || [x.siege,...(Array.isArray(x.matching_etablissements)?x.matching_etablissements:[])].some((e:any)=>String(e?.siret??"")===id)));
  if(!company) return null;
  const matches=[company.siege,...(Array.isArray(company.matching_etablissements)?company.matching_etablissements:[])].filter(Boolean);
  const establishment=(id.length===14?matches.find((e:any)=>String(e?.siret??"")===id):company.siege)??company.siege??null;
  return {
    siren:String(company.siren),
    siret:establishment?.siret?String(establishment.siret):company.siege?.siret?String(company.siege.siret):null,
    legalName:String(company.nom_raison_sociale??company.nom_complet??""),
    tradeName:establishment?.nom_commercial?String(establishment.nom_commercial):company.sigle?String(company.sigle):null,
    nafCode:String(establishment?.activite_principale??company.activite_principale??"")||null,
    legalFormCode:company.nature_juridique?String(company.nature_juridique):null,
    headquartersAddress:company.siege?.adresse?String(company.siege.adresse):establishment?.adresse?String(establishment.adresse):null,
    headquartersPostalCode:company.siege?.code_postal?String(company.siege.code_postal):establishment?.code_postal?String(establishment.code_postal):null,
    headquartersCity:company.siege?.libelle_commune?String(company.siege.libelle_commune):establishment?.libelle_commune?String(establishment.libelle_commune):null,
    active:String(company.etat_administratif??"")=="A" && String(establishment?.etat_administratif??company.siege?.etat_administratif??"A")=="A",
    source:"recherche-entreprises.data.gouv.fr", reference:`https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}`
  };
}
