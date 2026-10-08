/**
 * Stage 3 field rules: present only questions relevant to the selected
 * subcategory and (when known) product kind. Required discriminator fields
 * remain visible. Used for rendering, AI facts, autosave, and final submission.
 */
type Field={id:string;key:string;required:boolean};
type Selection={slug:string;domain:string;fields:Field[];values:Record<string,unknown>};

const BRAND_SUBCATEGORIES:Record<string,string>={
 "apple-iphone":"Apple","samsung-galaxy":"Samsung","google-pixel":"Google",
 "xiaomi-redmi-poco":"Xiaomi","oneplus-smartphones":"OnePlus","honor-smartphones":"Honor",
 "macbook":"Apple",
};
const APPLIANCE_SUBCATEGORIES=new Set([
 "aspirateurs","fours-plaques","lave-linge","lave-vaisselle",
 "refrigerateurs-congelateurs","seche-linge",
]);
const TWO_WHEELERS=new Set(["motos","scooters"]);
const LARGE_SCREEN_MEDIA=new Set(["Télévision","Vidéoprojecteur"]);
const CAMERA_MEDIA=new Set(["Appareil photo","Caméra"]);

function chosen(s:Selection,key:string):string{
 const def=s.fields.find(f=>f.key===key);
 return def?String(s.values[def.id]??""):"";
}

export function fixedListingFieldValue(slug:string,key:string):string|null{
 if(key==="brand"&&BRAND_SUBCATEGORIES[slug])return BRAND_SUBCATEGORIES[slug];
 if(key==="fuel"&&slug==="voitures-electriques")return "Électrique";
 if(key==="appliance"&&slug==="aspirateurs")return "Aspirateur";
 if(key==="appliance"&&slug==="lave-linge")return "Lave-linge";
 if(key==="appliance"&&slug==="lave-vaisselle")return "Lave-vaisselle";
 if(key==="appliance"&&slug==="seche-linge")return "Sèche-linge";
 return null;
}

export function listingFieldRelevant(s:Selection,field:Field):boolean{
 const {slug,key}= {slug:s.slug,key:field.key};
 // A whole product subcategory already answers these questions.
 if(fixedListingFieldValue(slug,key)!==null)return false;
 if(key==="appliance"&&APPLIANCE_SUBCATEGORIES.has(slug))return false;
 if(TWO_WHEELERS.has(slug)&&["doors","seats","fiscalPower","bodyStyle"].includes(key))return false;
 if(slug==="voitures-electriques"&&key==="gearbox")return false;
 if(slug==="nautisme"&&["doors","seats","fiscalPower","gearbox","critAir","firstRegistration"].includes(key))return false;

 // Category is a family: only ask dependent questions when the type is known.
 if(slug==="telephones-smartphones"){
  const kind=chosen(s,"deviceType");
  if(["Téléphone fixe","Objet connecté","Autre"].includes(kind)&&["ram","storage","dualSim","network","screenSize"].includes(key))return false;
  if(["Montre connectée","Bracelet connecté"].includes(kind)&&["ram","dualSim"].includes(key))return false;
 }
 if(slug==="photo-video"){
  const kind=chosen(s,"imageSoundProduct");
  if(kind&&!LARGE_SCREEN_MEDIA.has(kind)&&!CAMERA_MEDIA.has(kind)&&["screenSize","resolution","cameraType"].includes(key))return false;
  if(LARGE_SCREEN_MEDIA.has(kind)&&key==="cameraType")return false;
  if(CAMERA_MEDIA.has(kind)&&key==="screenSize")return false;
 }
 if(slug==="consoles"&&chosen(s,"videoGameType")==="Accessoires"&&key==="storage")return false;
 if(slug==="ordinateurs"&&["PC fixe","Mini PC","Serveur"].includes(chosen(s,"computerType"))&&["screenSize","resolution"].includes(key))return false;
 if(slug==="tablettes-liseuses"&&chosen(s,"deviceType")==="Liseuse"&&key==="ram")return false;
 return true;
}

export function relevantListingOptions(s:Selection,key:string,options:{id:string;value:string;label:string}[]){
 if(s.slug==="consoles"&&key==="platform"){
  const brand=chosen(s,"brand");
  const platformFamilies:Record<string,(value:string)=>boolean>={
   Sony:value=>/^PS\d/i.test(value),
   Nintendo:value=>/^(Switch|Wii|GameCube|Super Nintendo|Nintendo 64)/i.test(value),
   Microsoft:value=>/^Xbox/i.test(value),
   Valve:value=>/Steam Deck/i.test(value),
  };
  if(brand&&brand!=="Autre"&&platformFamilies[brand])
   return options.filter(o=>platformFamilies[brand]!(o.value)||o.value==="Autre");
  if(brand&&brand!=="Autre"&&!platformFamilies[brand])
   return options.filter(o=>o.value==="Autre");
 }
 if(s.slug==="voitures-hybrides"&&key==="fuel")return options.filter(o=>["Hybride","Hybride rechargeable"].includes(o.value));
 if(s.slug==="motos"||s.slug==="scooters"){
  if(key==="fuel")return options.filter(o=>["Essence","Électrique","Autre"].includes(o.value));
 }
 return options;
}
