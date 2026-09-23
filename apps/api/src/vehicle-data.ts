import { createHash } from "node:crypto";
import { z } from "zod";
import { getRuntimeIntegration } from "./admin-control.js";

const vehicleResponseSchema = z.object({
  source: z.string().min(1).max(80),
  make: z.string().max(100).nullish(),
  model: z.string().max(120).nullish(),
  version: z.string().max(160).nullish(),
  firstRegistrationDate: z.string().datetime().nullish(),
  modelYear: z.number().int().min(1900).max(2100).nullish(),
  fuel: z.string().max(80).nullish(),
  transmission: z.string().max(80).nullish(),
  bodyType: z.string().max(80).nullish(),
  powerKw: z.number().int().nonnegative().nullish(),
  fiscalPowerCv: z.number().int().nonnegative().nullish(),
  co2GKm: z.number().int().nonnegative().nullish(),
  euroStandard: z.string().max(40).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  doors: z.number().int().positive().max(20).nullish(),
  color: z.string().max(80).nullish(),
  history: z.object({
    firstRegistrationDate: z.string().datetime().nullish(),
    sraClass: z.string().max(120).nullish(),
    theftRiskLevel: z.string().max(120).nullish(),
    originalNewValueEuro: z.number().nonnegative().max(10_000_000).nullish(),
    ownerChanges: z.number().int().nonnegative().max(100).nullish(),
    controlledDamageCount: z.number().int().nonnegative().max(100).nullish(),
    administrativeStatus: z.string().max(160).nullish(),
    technicalInspectionDate: z.string().datetime().nullish(),
    technicalInspectionResult: z.string().max(160).nullish(),
    mileageKm: z.number().int().nonnegative().max(5_000_000).nullish(),
  }).optional(),
  wizardAttributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export type VehicleLookupResult = z.infer<typeof vehicleResponseSchema>;

type RuntimeVehicleConfig={provider:string;apiUrl?:string;apiToken?:string;providerToken?:string;apiHost?:string;regcheckUrl?:string;regcheckUsername?:string;openApiBaseUrl?:string;openApiToken?:string};
const RAPIDAPI_PROVIDER="rapidapi";
const RAPIDAPI_URL="https://api-plaque-immatriculation-siv.p.rapidapi.com";
const RAPIDAPI_HOST="api-plaque-immatriculation-siv.p.rapidapi.com";
const REGCHECK_URL="https://www.regcheck.org.uk/api/reg.asmx/CheckFrance";
const OPENAPI_AUTOMOTIVE_URL="https://automotive.openapi.com";

export function normalizeFrenchPlate(input: string) {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2}[0-9]{3}[A-Z]{2}$/.test(compact)) return `${compact.slice(0, 2)}-${compact.slice(2, 5)}-${compact.slice(5)}`;
  if (/^WW[0-9]{3}[A-Z]{2}$/.test(compact)) return `${compact.slice(0, 2)}-${compact.slice(2, 5)}-${compact.slice(5)}`;
  if (/^[0-9]{1,4}[A-Z]{1,3}[0-9]{2,3}$/.test(compact)) return compact;
  throw new Error("invalid_registration_plate");
}

export function plateHash(plate: string) { return createHash("sha256").update(plate).digest("hex"); }

async function runtimeVehicleConfig():Promise<RuntimeVehicleConfig|null>{
  const configured=await getRuntimeIntegration("vehicle-data");
  const enabled=Boolean(configured?.enabled);
  const provider=String(enabled?configured?.config.provider??"regcheck":process.env.VEHICLE_DATA_PROVIDER??"regcheck").toLowerCase();
  const apiUrl=String(enabled?configured?.config.apiUrl??RAPIDAPI_URL:process.env.VEHICLE_DATA_API_URL??RAPIDAPI_URL)||undefined;
  const apiToken=String(enabled?configured?.secrets.apiToken??"":process.env.VEHICLE_DATA_API_TOKEN??"")||undefined;
  const providerToken=String(enabled?configured?.secrets.providerToken??"":process.env.VEHICLE_DATA_PROVIDER_TOKEN??"")||undefined;
  const apiHost=String(enabled?configured?.config.apiHost??RAPIDAPI_HOST:process.env.VEHICLE_DATA_API_HOST??RAPIDAPI_HOST)||undefined;
  const configuredRegcheckUrl=String(enabled?configured?.config.regcheckUrl??"":process.env.VEHICLE_DATA_REGCHECK_URL??"").trim();
  const regcheckUrl=configuredRegcheckUrl||REGCHECK_URL;
  const regcheckUsername=String(enabled?configured?.secrets.regcheckUsername??"":process.env.VEHICLE_DATA_REGCHECK_USERNAME??"")||undefined;
  const configuredOpenApiBaseUrl=String(enabled?configured?.config.openApiBaseUrl??"":process.env.VEHICLE_DATA_OPENAPI_BASE_URL??"").trim();
  const openApiBaseUrl=configuredOpenApiBaseUrl||OPENAPI_AUTOMOTIVE_URL;
  const openApiToken=String(enabled?configured?.secrets.openApiToken??"":process.env.VEHICLE_DATA_OPENAPI_TOKEN??"")||undefined;
  if(!enabled&&!apiToken&&!regcheckUsername&&!openApiToken)return null;
  return{provider,apiUrl,apiToken,providerToken,apiHost,regcheckUrl,regcheckUsername,openApiBaseUrl,openApiToken};
}

function cleanDate(value:unknown){
  if(typeof value!=="string"||!value.trim())return null;
  const raw=value.trim();
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T00:00:00.000Z`:raw;
  return Number.isNaN(Date.parse(parsed))?null:new Date(parsed).toISOString();
}
function numberOrNull(value:unknown){if(value===null||value===undefined||value==="")return null;const n=Number(value);return Number.isFinite(n)?n:null}
function textOrNull(value:unknown){
  if(typeof value!=="string")return null;
  const text=value.trim();
  if(!text||["INCONNU","UNKNOWN","N/A","NC","NON RENSEIGNE","NON RENSEIGNÉ"].includes(text.toUpperCase()))return null;
  return text;
}
function intOrNull(value:unknown){const n=numberOrNull(value);return n==null?null:Math.max(0,Math.round(n))}
function cleanVehicleModel(value:unknown,modelYear:number|null){const model=textOrNull(value);if(!model)return null;if(/^(?:19|20)\d{2}$/.test(model)&&(!modelYear||Number(model)===modelYear))return null;return model}
function historyFromPayload(data:any,firstRegistrationDate:string|null,extra?:{sraClass?:unknown;theftRiskLevel?:unknown;originalNewValueEuro?:unknown}){
  return {
    firstRegistrationDate,
    sraClass:textOrNull(extra?.sraClass??data?.classeSra??data?.sraClass),
    theftRiskLevel:textOrNull(extra?.theftRiskLevel??data?.niveauRisqueVol??data?.theftRiskLevel),
    originalNewValueEuro:numberOrNull(extra?.originalNewValueEuro??data?.valeurANeufSRA??data?.originalNewValueEuro),
    ownerChanges:intOrNull(data?.ownerChanges??data?.nombreChangementsTitulaire??data?.numberOfOwnerChanges),
    controlledDamageCount:intOrNull(data?.controlledDamageCount??data?.sinistresReparationControlee??data?.controlledRepairDamageCount),
    administrativeStatus:textOrNull(data?.administrativeStatus??data?.statutAdministratif??data?.situationAdministrative),
    technicalInspectionDate:cleanDate(data?.technicalInspectionDate??data?.dateControleTechnique??data?.controleTechniqueDate),
    technicalInspectionResult:textOrNull(data?.technicalInspectionResult??data?.resultatControleTechnique??data?.controleTechniqueResultat),
    mileageKm:intOrNull(data?.mileageKm??data?.kilometrage??data?.odometerKm),
  };
}
function decodeXml(value:string){return value.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");}
function nestedText(value:any){
  if(typeof value==="string")return textOrNull(value);
  if(value&&typeof value==="object")return textOrNull(value.CurrentTextValue??value.currentTextValue??value.CurrentValue??value.currentValue);
  return null;
}
function normalizeFuel(value:unknown,electric:unknown){
  if(String(electric??"").toLowerCase()==="true"||String(electric??"")==="1")return "Électrique";
  const t=String(value??"").trim().toUpperCase();
  if(!t)return null;
  if(t.includes("HYBR")&&(/RECHARG|PHEV/.test(t)))return "Hybride rechargeable";
  if(t.includes("HYBR"))return "Hybride";
  if(/ELECT|ELEC/.test(t))return "Électrique";
  if(/DIESEL|GAZOLE/.test(t))return "Diesel";
  if(/ESSENCE|GASOLINE|PETROL/.test(t))return "Essence";
  if(t.includes("GPL")||t.includes("LPG"))return "GPL";
  if(t.includes("E85")||t.includes("FLEX"))return "E85";
  return "Autre";
}
function normalizeTransmission(value:unknown){const t=String(value??"").trim().toUpperCase();if(!t)return null;if(/AUTO|BVA|CVT|DSG|EDC/.test(t))return "Automatique";if(/MANU|MECA|BVM/.test(t))return "Manuelle";return null}
function normalizeBody(value:unknown){const t=String(value??"").trim().toUpperCase();if(!t)return null;if(t.includes("SUV")||t.includes("CROSSOVER"))return "SUV";if(t.includes("BREAK")||t.includes("ESTATE"))return "Break";if(t.includes("CABRIO"))return "Cabriolet";if(t.includes("COUPE")||t.includes("COUPÉ"))return "Coupé";if(t.includes("MONOSPACE")||t.includes("MPV"))return "Monospace";if(t.includes("UTILITAIRE")||t.includes("FOURGON")||t.includes("VAN"))return "Utilitaire léger";if(t.includes("CITADINE")||t.includes("HATCH"))return "Citadine";if(t.includes("BERLINE")||t.includes("SALOON")||t.includes("SEDAN"))return "Berline";return null}
function mapRegCheck(payload:any):VehicleLookupResult{
  const raw=payload?.vehicleData??payload;
  const ext=payload?.ExtendedData??{};
  const make=nestedText(payload?.CarMake)??textOrNull(payload?.MakeDescription??raw?.MakeDescription??ext?.marque);
  const rawModel=nestedText(payload?.CarModel)??textOrNull(payload?.ModelDescription??raw?.ModelDescription??ext?.libelleModele??ext?.modele);
  const version=textOrNull(payload?.Version??raw?.Version??ext?.libVersion??ext?.version);
  const firstRegistrationDate=cleanDate(payload?.DateOfRegistration??payload?.RegistrationDate??raw?.DateOfRegistration??raw?.RegistrationDate??ext?.datePremiereMiseCirculation);
  const modelYear=numberOrNull(payload?.RegistrationYear??raw?.RegistrationYear??ext?.anneeSortie);
  const model=cleanVehicleModel(rawModel,modelYear);
  const fuel=normalizeFuel(nestedText(payload?.FuelType)??raw?.FuelType??ext?.carburantVersion,ext?.electrique);
  const transmission=normalizeTransmission(nestedText(payload?.Transmission)??raw?.Transmission??ext?.boiteDeVitesse);
  const bodyType=normalizeBody(nestedText(payload?.BodyStyle)??raw?.BodyStyle??ext?.carrosserieVersion??ext?.cleCarrosserie??ext?.typeVehicule);
  const fiscalPowerCv=numberOrNull(payload?.FiscalPower??raw?.FiscalPower??ext?.puissance);
  const dynHp=numberOrNull(ext?.puissanceDyn);
  const powerKw=numberOrNull(payload?.PowerKW??raw?.PowerKW)??(dynHp?Math.round(dynHp*0.735499):null);
  const co2GKm=numberOrNull(payload?.CO2Emissions??raw?.CO2Emissions??ext?.Co2);
  const seats=numberOrNull(payload?.NumberOfSeats?.CurrentValue??payload?.NumberOfSeats?.CurrentTextValue??raw?.NumberOfSeats??ext?.nbPlace);
  const doors=numberOrNull(payload?.NumberOfDoors?.CurrentValue??payload?.NumberOfDoors?.CurrentTextValue??raw?.NumberOfDoors);
  const color=nestedText(payload?.Colour)??nestedText(payload?.Color)??textOrNull(raw?.Colour??raw?.Color);
  const engineSize=numberOrNull(ext?.EngineCC)??numberOrNull(payload?.EngineCC??raw?.EngineCC);
  const wizardAttributes:Record<string,string|number|boolean>={};
  for(const [k,v] of Object.entries({brand:make,model,firstRegistration:firstRegistrationDate?.slice(0,10),fuel,gearbox:transmission,fiscalPower:fiscalPowerCv,powerKw,seats,doors:doors?String(doors):null,bodyStyle:bodyType,engineSize}))if(v!==null&&v!==undefined&&v!=="")wizardAttributes[k]=v as string|number|boolean;
  return vehicleResponseSchema.parse({
    source:"regcheck-france",make,model,version,firstRegistrationDate,modelYear,fuel,transmission,bodyType,powerKw,fiscalPowerCv,co2GKm,
    euroStandard:textOrNull(payload?.EuroStatus??raw?.EuroStatus),seats,doors,color,
    history:historyFromPayload(ext,firstRegistrationDate,{sraClass:ext?.classeSra,theftRiskLevel:ext?.niveauRisqueVol,originalNewValueEuro:ext?.valeurANeufSRA}),wizardAttributes,
  });
}
async function lookupRegCheck(config:RuntimeVehicleConfig,registrationPlate:string){
  if(!config.regcheckUsername||!config.regcheckUrl)throw new Error("vehicle_data_provider_not_configured");
  const url=new URL(config.regcheckUrl);
  url.searchParams.set("RegistrationNumber",registrationPlate.replace(/[^A-Z0-9]/gi,""));
  url.searchParams.set("username",config.regcheckUsername);
  const response=await fetch(url,{method:"GET",headers:{accept:"text/xml,application/xml"},signal:AbortSignal.timeout(10000)});
  if(response.status===401||response.status===403)throw new Error("vehicle_provider_auth_failed");
  if(response.status===429)throw new Error("vehicle_provider_rate_limited");
  if(!response.ok)throw new Error("vehicle_provider_unavailable");
  const xml=await response.text();
  if(/invalid username|not authorised|not authorized/i.test(xml))throw new Error("vehicle_provider_auth_failed");
  if(/no credits|zero credits|insufficient credits|credit balance/i.test(xml))throw new Error("vehicle_provider_subscription_expired");
  const match=xml.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/i);
  if(!match?.[1])throw new Error("vehicle_not_found");
  const jsonText=decodeXml(match[1].trim());
  let payload:any;
  try{payload=JSON.parse(jsonText)}catch{throw new Error("vehicle_provider_unavailable")}
  if(!payload||payload.Error||payload.error||/not found|introuvable/i.test(String(payload?.Message??payload?.message??"")))throw new Error("vehicle_not_found");
  return mapRegCheck(payload);
}

function mapRapidApi(payload:any):VehicleLookupResult{
  if(payload?.error===true)throw new Error(payload?.code===404?"vehicle_not_found":"vehicle_provider_unavailable");
  const data=payload?.data??payload?.vehicle??payload;
  const make=textOrNull(data?.AWN_marque??data?.marque??data?.make);
  const rawModel=textOrNull(data?.AWN_modele??data?.modele??data?.model);
  const version=textOrNull(data?.AWN_version??data?.version??data?.finition);
  const firstRegistrationDate=cleanDate(data?.AWN_date_mise_en_circulation??data?.date1erCir_us??data?.date_mise_circulation??data?.date_mise_en_circulation??data?.datePremiereMiseEnCirculation??data?.firstRegistrationDate);
  const modelYear=numberOrNull(data?.AWN_annee??data?.annee??data?.annee_modele??data?.modelYear);
  const model=cleanVehicleModel(rawModel,modelYear);
  const fuel=normalizeFuel(data?.AWN_energie??data?.energieNGC??data?.energie??data?.motorisation??data?.carburant??data?.fuel,data?.AWN_electrique??data?.electrique);
  const transmission=normalizeTransmission(data?.AWN_type_boite_vites??data?.type_transmission??data?.boite_vitesse??data?.boite_de_vitesse??data?.transmission);
  const bodyType=normalizeBody(data?.AWN_carrosserie??data?.carrosserie??data?.carrosserieCG??data?.genreVCGNGC??data?.genreVCG??data?.genre??data?.bodyType);
  const powerKw=numberOrNull(data?.AWN_puissance_KW??data?.puisFiscReelKW??data?.puissance_kw??data?.powerKw??data?.kw);
  const fiscalPowerCv=numberOrNull(data?.AWN_puissance_fiscale??data?.puisFisc??data?.puissance_fiscale??data?.cv_fiscaux??data?.fiscalPowerCv);
  const co2GKm=numberOrNull(data?.AWN_emission_co_2??data?.co2??data?.emission_co_2??data?.emission_co2??data?.co2GKm);
  const euroStandard=textOrNull(data?.AWN_depollution??data?.norme_euro??data?.euroStandard??data?.normeEuro);
  const seats=numberOrNull(data?.AWN_nbr_de_places??data?.nr_passagers??data?.places??data?.nombre_places??data?.seats);
  const doors=numberOrNull(data?.AWN_nbr_portes??data?.nb_portes??data?.portes??data?.nombre_portes??data?.doors);
  const color=textOrNull(data?.AWN_couleur??data?.couleur??data?.color);
  const engineSize=numberOrNull(data?.AWN_cylindree??data?.cylindree??data?.cylindree_cm3??data?.engine_cc??data?.engineSize??data?.EngineCC);
  const wizardAttributes:Record<string,string|number|boolean>={};
  for(const [k,v] of Object.entries({brand:make,model,firstRegistration:firstRegistrationDate?.slice(0,10),fuel,gearbox:transmission,fiscalPower:fiscalPowerCv,powerKw,seats,doors:doors?String(doors):null,color,bodyStyle:bodyType,engineSize}))if(v!==null&&v!==undefined&&v!=="")wizardAttributes[k]=v as string|number|boolean;
  return vehicleResponseSchema.parse({source:"api-plaque-immatriculation",make,model,version,firstRegistrationDate,modelYear,fuel,transmission,bodyType,powerKw,fiscalPowerCv,co2GKm,euroStandard,seats,doors,color,history:historyFromPayload(data,firstRegistrationDate),wizardAttributes});
}

async function lookupRapidApi(config:RuntimeVehicleConfig,registrationPlate:string){
  if(!config.apiUrl||!config.apiToken)throw new Error("vehicle_data_provider_not_configured");
  const base=config.apiUrl.replace(/\/$/,"");
  const url=new URL(`${base}/get-vehicule-info`);
  url.searchParams.set("immatriculation",registrationPlate);
  url.searchParams.set("pays","FR");
  if(config.providerToken)url.searchParams.set("token",config.providerToken);
  const host=config.apiHost||url.host;
  const response=await fetch(url,{method:"GET",headers:{"X-RapidAPI-Key":config.apiToken,"X-RapidAPI-Host":host,accept:"application/json"},signal:AbortSignal.timeout(8000)});
  if(response.status===400)throw new Error("invalid_registration_plate");
  if(response.status===404)throw new Error("vehicle_not_found");
  if(response.status===401||response.status===403){
    const text=await response.text().catch(()=>"");
    if(/abonnement expir/i.test(text))throw new Error("vehicle_provider_subscription_expired");
    throw new Error("vehicle_provider_auth_failed");
  }
  if(response.status===429)throw new Error("vehicle_provider_rate_limited");
  if(!response.ok)throw new Error("vehicle_provider_unavailable");
  const payload=await response.json();
  if(payload?.error||payload?.erreur||payload?.message==="Aucun véhicule trouvé")throw new Error("vehicle_not_found");
  return mapRapidApi(payload);
}

function mapOpenApi(payload:any):VehicleLookupResult{
  if(payload?.success===false)throw new Error(payload?.error?.code===404?"vehicle_not_found":"vehicle_provider_unavailable");
  const data=payload?.data??payload;
  const make=textOrNull(data?.CarMake??data?.MakeDescription??data?.make??data?.marque);
  const rawModel=textOrNull(data?.CarModel??data?.ModelDescription??data?.model??data?.modele);
  const version=textOrNull(data?.Version??data?.version??data?.finition);
  const firstRegistrationDate=cleanDate(data?.RegistrationDate??data?.registrationDate??data?.DateOfRegistration);
  const modelYear=numberOrNull(data?.RegistrationYear??data?.registrationYear??data?.modelYear);
  const model=cleanVehicleModel(rawModel,modelYear);
  const fuel=normalizeFuel(data?.FuelType??data?.fuelType??data?.fuel,data?.Electric??data?.electric);
  const transmission=normalizeTransmission(data?.Transmission??data?.Gearbox??data?.transmission??data?.gearbox);
  const bodyType=normalizeBody(data?.BodyStyle??data?.bodyStyle??data?.bodyType);
  const powerKw=numberOrNull(data?.PowerKW??data?.powerKw??data?.KW??data?.kw);
  const fiscalPowerCv=numberOrNull(data?.FiscalPower??data?.fiscalPower??data?.FiscalHorsePower??data?.fiscalHorsePower);
  const co2GKm=numberOrNull(data?.CO2Emissions??data?.Co2??data?.co2??data?.co2GKm);
  const euroStandard=textOrNull(data?.EuroStatus??data?.EuroStandard??data?.euroStandard);
  const seats=numberOrNull(data?.NumberOfSeats??data?.Seats??data?.seats);
  const doors=numberOrNull(data?.NumberOfDoors??data?.Doors??data?.doors);
  const color=textOrNull(data?.Colour??data?.Color??data?.colour??data?.color);
  const engineSize=numberOrNull(data?.EngineCC??data?.engineCC??data?.CylinderCapacity??data?.cylinderCapacity??data?.Displacement??data?.displacement);
  const wizardAttributes:Record<string,string|number|boolean>={};
  for(const [k,v] of Object.entries({brand:make,model,firstRegistration:firstRegistrationDate?.slice(0,10),fuel,gearbox:transmission,fiscalPower:fiscalPowerCv,powerKw,seats,doors:doors?String(doors):null,color,bodyStyle:bodyType,engineSize}))if(v!==null&&v!==undefined&&v!=="")wizardAttributes[k]=v as string|number|boolean;
  return vehicleResponseSchema.parse({source:"openapi-automotive",make,model,version,firstRegistrationDate,modelYear,fuel,transmission,bodyType,powerKw,fiscalPowerCv,co2GKm,euroStandard,seats,doors,color,history:historyFromPayload(data,firstRegistrationDate),wizardAttributes});
}

async function lookupOpenApi(config:RuntimeVehicleConfig,registrationPlate:string){
  if(!config.openApiBaseUrl||!config.openApiToken)throw new Error("vehicle_data_provider_not_configured");
  const base=config.openApiBaseUrl.replace(/\/$/,"");
  const plate=registrationPlate.replace(/[^A-Z0-9]/gi,"");
  const url=`${base}/FR-car/${encodeURIComponent(plate)}`;
  const response=await fetch(url,{method:"GET",headers:{authorization:`Bearer ${config.openApiToken}`,accept:"application/json"},signal:AbortSignal.timeout(10000)});
  if(response.status===400||response.status===406||response.status===417||response.status===428)throw new Error("invalid_registration_plate");
  if(response.status===404)throw new Error("vehicle_not_found");
  if(response.status===401||response.status===403)throw new Error("vehicle_provider_auth_failed");
  if(response.status===402)throw new Error("vehicle_provider_subscription_expired");
  if(response.status===429)throw new Error("vehicle_provider_rate_limited");
  if(!response.ok)throw new Error("vehicle_provider_unavailable");
  const payload=await response.json();
  if(payload?.success===false||payload?.error)throw new Error(/not found|introuvable/i.test(String(payload?.message??payload?.error?.message??""))?"vehicle_not_found":"vehicle_provider_unavailable");
  return mapOpenApi(payload);
}

async function lookupGeneric(config:RuntimeVehicleConfig,registrationPlate:string){
  if(!config.apiUrl||!config.apiToken)throw new Error("vehicle_data_provider_not_configured");
  const response=await fetch(config.apiUrl,{method:"POST",headers:{authorization:`Bearer ${config.apiToken}`,"content-type":"application/json",accept:"application/json"},body:JSON.stringify({registrationPlate}),signal:AbortSignal.timeout(8000)});
  if(response.status===404)throw new Error("vehicle_not_found");
  if(response.status===401||response.status===403)throw new Error("vehicle_provider_auth_failed");
  if(response.status===429)throw new Error("vehicle_provider_rate_limited");
  if(!response.ok)throw new Error("vehicle_provider_unavailable");
  return vehicleResponseSchema.parse(await response.json());
}

export async function lookupVehicleByPlate(rawPlate: string): Promise<VehicleLookupResult> {
  const registrationPlate = normalizeFrenchPlate(rawPlate);
  const config=await runtimeVehicleConfig();
  if(!config)throw new Error("vehicle_data_provider_not_configured");

  const openApiPrimary=["openapi","openapi-automotive","openapi.fr"].includes(config.provider);
  const rapidPrimary=["rapidapi","api-plaque-immatriculation","api-plaque"].includes(config.provider);

  if(openApiPrimary&&config.openApiToken){
    try{return await lookupOpenApi(config,registrationPlate)}catch(error){
      const code=error instanceof Error?error.message:"vehicle_provider_unavailable";
      if(code==="invalid_registration_plate")throw error;
      if(config.regcheckUsername){try{return await lookupRegCheck(config,registrationPlate)}catch{}}
      if(config.apiToken)return lookupRapidApi(config,registrationPlate);
      throw error;
    }
  }

  if(rapidPrimary&&config.apiToken){
    try{return await lookupRapidApi(config,registrationPlate)}catch(error){
      const code=error instanceof Error?error.message:"vehicle_provider_unavailable";
      if(code==="invalid_registration_plate")throw error;
      if(config.openApiToken){try{return await lookupOpenApi(config,registrationPlate)}catch{}}
      if(config.regcheckUsername)return lookupRegCheck(config,registrationPlate);
      throw error;
    }
  }

  if(config.regcheckUsername){
    try{return await lookupRegCheck(config,registrationPlate)}catch(error){
      const code=error instanceof Error?error.message:"vehicle_provider_unavailable";
      if(code==="invalid_registration_plate")throw error;
      if(config.openApiToken){try{return await lookupOpenApi(config,registrationPlate)}catch{}}
      if(config.apiToken){try{return await lookupRapidApi(config,registrationPlate)}catch{}}
      throw error;
    }
  }

  if(config.openApiToken)return lookupOpenApi(config,registrationPlate);
  if(config.apiToken)return lookupRapidApi(config,registrationPlate);
  return lookupGeneric(config,registrationPlate);
}
