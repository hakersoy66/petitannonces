export const EMPLOI_LOCAL_LANDINGS=[
 {city:"paris",cityName:"Paris",area:"Paris (75)",department:"75",sector:"developpeur",role:"Développeur informatique",term:"développeur"},
 {city:"paris",cityName:"Paris",area:"Paris (75)",department:"75",sector:"assistant",role:"Assistant administratif",term:"assistant"},
 {city:"lyon",cityName:"Lyon",area:"Lyon et Rhône (69)",department:"69",sector:"chauffeur",role:"Chauffeur-livreur",term:"chauffeur"},
 {city:"lyon",cityName:"Lyon",area:"Lyon et Rhône (69)",department:"69",sector:"developpeur",role:"Développeur informatique",term:"développeur"},
 {city:"marseille",cityName:"Marseille",area:"Marseille et Bouches-du-Rhône (13)",department:"13",sector:"vendeur",role:"Vendeur / vendeuse",term:"vendeur"},
 {city:"toulouse",cityName:"Toulouse",area:"Toulouse et Haute-Garonne (31)",department:"31",sector:"restauration",role:"Restauration",term:"restauration"},
 {city:"lille",cityName:"Lille",area:"Lille et Nord (59)",department:"59",sector:"logistique",role:"Logistique",term:"logistique"},
 {city:"bordeaux",cityName:"Bordeaux",area:"Bordeaux et Gironde (33)",department:"33",sector:"commercial",role:"Commercial",term:"commercial"}
] as const;
export const emploiLocalHref=(e:{city:string;sector:string})=>"/emploi/offres/"+e.city+"/"+e.sector;
export function emploiLocalLanding(city:string,sector:string){
 return EMPLOI_LOCAL_LANDINGS.find(x=>x.city===city&&x.sector===sector)??null;
}
