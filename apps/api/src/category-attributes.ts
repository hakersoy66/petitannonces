import { prisma } from "@pa/database";

export async function categoryLineageIds(categoryId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;depth:number}>>(`WITH RECURSIVE lineage AS (
    SELECT "id","parentId",0::int AS depth FROM "Category" WHERE "id"=$1
    UNION ALL
    SELECT c."id",c."parentId",l.depth+1 FROM "Category" c JOIN lineage l ON l."parentId"=c."id"
  ) SELECT "id",depth FROM lineage ORDER BY depth DESC`,categoryId);
  return rows;
}

export async function categoryAttributeDefinitions(categoryId:string,{requiredOnly=false}:{requiredOnly?:boolean}={}){
  const lineage=await categoryLineageIds(categoryId);
  if(!lineage.length)return [];
  const depth=new Map(lineage.map(row=>[row.id,row.depth] as const));
  const definitions=await prisma.categoryAttribute.findMany({
    where:{categoryId:{in:lineage.map(row=>row.id)}},
    include:{options:{orderBy:{sortOrder:"asc"}}},
    orderBy:[{sortOrder:"asc"},{label:"asc"}],
  });
  definitions.sort((a,b)=>(depth.get(b.categoryId)??0)-(depth.get(a.categoryId)??0)||a.sortOrder-b.sortOrder||a.label.localeCompare(b.label,"fr"));
  const byKey=new Map<string,(typeof definitions)[number]>();
  for(const definition of definitions)byKey.set(definition.key,definition);
  return [...byKey.values()].filter(definition=>!requiredOnly||definition.required).sort((a,b)=>a.sortOrder-b.sortOrder||a.label.localeCompare(b.label,"fr"));
}

export async function categoryBelongsToRootSlug(categoryId:string,rootSlug:string){
  const rows=await prisma.$queryRawUnsafe<Array<{slug:string}>>(`WITH RECURSIVE lineage AS (
    SELECT "id","parentId","slug" FROM "Category" WHERE "id"=$1
    UNION ALL
    SELECT c."id",c."parentId",c."slug" FROM "Category" c JOIN lineage l ON l."parentId"=c."id"
  ) SELECT "slug" FROM lineage`,categoryId);
  return rows.some(row=>row.slug===rootSlug);
}
