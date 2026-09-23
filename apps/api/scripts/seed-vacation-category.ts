import { prisma } from "@pa/database";

type AttributeSeed={key:string;label:string;type:"TEXT"|"NUMBER"|"BOOLEAN"|"SELECT"|"MULTISELECT"|"DATE";unit?:string;required?:boolean;filterable?:boolean;searchable?:boolean;sortOrder:number;options?:Array<[string,string]>};

const rootAttrs:AttributeSeed[]=[
 {key:"capacity",label:"Nombre de voyageurs",type:"NUMBER",unit:"personnes",required:true,sortOrder:10},
 {key:"availableFrom",label:"Disponible du",type:"DATE",required:true,filterable:false,sortOrder:20},
 {key:"availableTo",label:"Disponible jusqu’au",type:"DATE",required:true,filterable:false,sortOrder:30},
 {key:"minimumNights",label:"Séjour minimum",type:"NUMBER",unit:"nuits",required:true,sortOrder:40},
 {key:"bedrooms",label:"Chambres",type:"NUMBER",sortOrder:50},
 {key:"beds",label:"Couchages / lits",type:"NUMBER",sortOrder:60},
 {key:"bathrooms",label:"Salles de bain",type:"NUMBER",sortOrder:70},
 {key:"surface",label:"Surface",type:"NUMBER",unit:"m²",sortOrder:80},
 {key:"amenities",label:"Équipements",type:"MULTISELECT",sortOrder:90,options:[["wifi","Wi-Fi"],["parking","Parking"],["pool","Piscine"],["air-conditioning","Climatisation"],["kitchen","Cuisine"],["washer","Lave-linge"],["terrace-balcony","Terrasse / balcon"],["sea-view","Vue mer"],["spa","Spa / jacuzzi"],["breakfast","Petit-déjeuner"]]},
 {key:"petsAllowed",label:"Animaux acceptés",type:"BOOLEAN",sortOrder:100},
 {key:"smokingAllowed",label:"Fumeurs acceptés",type:"BOOLEAN",sortOrder:110},
 {key:"accessible",label:"Accessible PMR",type:"BOOLEAN",sortOrder:120},
 {key:"cancellationPolicy",label:"Conditions d’annulation",type:"SELECT",sortOrder:130,options:[["flexible","Flexible"],["moderate","Modérée"],["strict","Stricte"]]},
];
const children=[
 {name:"Hôtels & chambres",slug:"hotels-chambres",sortOrder:10,attrs:[{key:"roomType",label:"Type de chambre",type:"SELECT",sortOrder:10,options:[["single","Simple"],["double","Double"],["family","Familiale"],["suite","Suite"]]},{key:"starRating",label:"Classement",type:"NUMBER",unit:"étoiles",sortOrder:20},{key:"breakfastIncluded",label:"Petit-déjeuner inclus",type:"BOOLEAN",sortOrder:30}] as AttributeSeed[]},
 {name:"Appartements de vacances",slug:"appartements-vacances",sortOrder:20,attrs:[{key:"floor",label:"Étage",type:"NUMBER",sortOrder:10},{key:"elevator",label:"Ascenseur",type:"BOOLEAN",sortOrder:20},{key:"entirePlace",label:"Logement entier",type:"BOOLEAN",sortOrder:30}] as AttributeSeed[]},
 {name:"Maisons & villas",slug:"maisons-villas-vacances",sortOrder:30,attrs:[{key:"privatePool",label:"Piscine privée",type:"BOOLEAN",sortOrder:10},{key:"garden",label:"Jardin",type:"BOOLEAN",sortOrder:20}] as AttributeSeed[]},
 {name:"Gîtes & chambres d’hôtes",slug:"gites-chambres-hotes",sortOrder:40,attrs:[{key:"breakfastIncluded",label:"Petit-déjeuner inclus",type:"BOOLEAN",sortOrder:10}] as AttributeSeed[]},
 {name:"Campings & mobil-homes",slug:"campings-mobil-homes",sortOrder:50,attrs:[{key:"pitchType",label:"Type d’hébergement",type:"SELECT",sortOrder:10,options:[["pitch","Emplacement"],["mobile-home","Mobil-home"],["chalet","Chalet"],["tent","Tente / lodge"]]}] as AttributeSeed[]},
];

async function seedAttributes(categoryId:string,seeds:AttributeSeed[]){
 for(const seed of seeds){
  const attribute=await prisma.categoryAttribute.upsert({
   where:{categoryId_key:{categoryId,key:seed.key}},
   create:{categoryId,key:seed.key,label:seed.label,type:seed.type,unit:seed.unit??null,required:seed.required??false,filterable:seed.filterable??true,searchable:seed.searchable??false,sortOrder:seed.sortOrder},
   update:{label:seed.label,type:seed.type,unit:seed.unit??null,required:seed.required??false,filterable:seed.filterable??true,searchable:seed.searchable??false,sortOrder:seed.sortOrder},
  });
  if(seed.options){
   await prisma.categoryAttributeOption.deleteMany({where:{attributeId:attribute.id}});
   await prisma.categoryAttributeOption.createMany({data:seed.options.map(([value,label],index)=>({attributeId:attribute.id,value,label,sortOrder:(index+1)*10}))});
  }
 }
}

async function main(){
 const existing=await prisma.category.findUnique({where:{slug:"vacances"}});
 const root=existing?await prisma.category.update({where:{id:existing.id},data:{name:"Vacances",domain:"GENERAL",isActive:true,sortOrder:25,iconKey:"calendar",parentId:null}}):await prisma.category.create({data:{name:"Vacances",slug:"vacances",domain:"GENERAL",isActive:true,sortOrder:25,iconKey:"calendar"}});
 await seedAttributes(root.id,rootAttrs);
 for(const child of children){
  const found=await prisma.category.findUnique({where:{slug:child.slug}});
  const category=found?await prisma.category.update({where:{id:found.id},data:{name:child.name,domain:"GENERAL",isActive:true,sortOrder:child.sortOrder,iconKey:"calendar",parentId:root.id}}):await prisma.category.create({data:{name:child.name,slug:child.slug,domain:"GENERAL",isActive:true,sortOrder:child.sortOrder,iconKey:"calendar",parentId:root.id}});
  await seedAttributes(category.id,child.attrs);
 }
 await prisma.$executeRawUnsafe(`UPDATE "AdminSetting" SET "value"=jsonb_set("value",'{navigationCategorySlugs}',to_jsonb(ARRAY['vehicules','immobilier','vacances','high-tech','mode','emploi','maison-jardin','services','enfants-bebe','animaux']::text[]),true),"updatedAt"=CURRENT_TIMESTAMP WHERE "key"='site.settings'`);
 const counts=await prisma.category.findMany({where:{OR:[{id:root.id},{parentId:root.id}]},select:{name:true,slug:true,parentId:true,_count:{select:{attributes:true}}},orderBy:{sortOrder:"asc"}});
 console.log(JSON.stringify({root:root.slug,categories:counts},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>prisma.$disconnect());