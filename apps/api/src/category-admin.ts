import { createHash, randomUUID } from "node:crypto";
import { prisma, Prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
const domainSchema = z.enum(["GENERAL","VEHICLE","REAL_ESTATE","JOB","SERVICE","ANIMAL"]);
const categoryBody = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  domain: domainSchema,
  parentId: z.string().min(1).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(-10000).max(10000).default(0),
  iconKey: z.string().trim().max(60).nullable().default(null),
});

async function actorId(request: FastifyRequest) {
  const token=request.cookies.pa_session;if(!token)return null;
  const tokenHash=createHash("sha256").update(token).digest("hex");
  const session=await prisma.session.findUnique({where:{tokenHash},select:{userId:true,revokedAt:true,expiresAt:true}});
  return session&&!session.revokedAt&&session.expiresAt>new Date()?session.userId:null;
}
async function audit(request: FastifyRequest, action:string, entityId:string, metadata?:unknown){
  const actor=await actorId(request);if(!actor)return;
  await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,'CATEGORY',$4,$5::jsonb)`,randomUUID(),actor,action,entityId,metadata?JSON.stringify(metadata):null);
}
async function wouldCreateCycle(id:string,parentId:string|null){
  if(!parentId)return false;if(parentId===id)return true;
  let cursor:string|null=parentId;
  for(let i=0;i<20&&cursor;i++){
    if(cursor===id)return true;
    const row:{parentId:string|null}|null=await prisma.category.findUnique({where:{id:cursor},select:{parentId:true}});
    cursor=row?.parentId??null;
  }
  return false;
}

export async function registerCategoryAdminRoutes(app:FastifyInstance){
  app.get("/admin/categories",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(_request,reply)=>{
    const rows=await prisma.category.findMany({
      include:{parent:{select:{id:true,name:true,slug:true}},_count:{select:{children:true,listings:true,attributes:true}}},
      orderBy:[{parentId:"asc"},{sortOrder:"asc"},{name:"asc"}],
    });
    return reply.send({categories:rows.map(c=>({id:c.id,name:c.name,slug:c.slug,domain:c.domain,parentId:c.parentId,parent:c.parent,isActive:c.isActive,sortOrder:c.sortOrder,iconKey:c.iconKey,counts:{children:c._count.children,listings:c._count.listings,attributes:c._count.attributes},createdAt:c.createdAt,updatedAt:c.updatedAt}))});
  });

  app.post("/admin/categories",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const body=categoryBody.safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_category",details:body.error.flatten()});
    if(body.data.parentId){const parent=await prisma.category.findUnique({where:{id:body.data.parentId}});if(!parent)return reply.code(400).send({error:"parent_not_found"});}
    try{
      const created=await prisma.category.create({data:body.data});
      await audit(request,"CATEGORY_CREATED",created.id,{name:created.name,slug:created.slug,parentId:created.parentId});
      return reply.code(201).send({category:created});
    }catch(error){if(String(error).includes("Unique constraint")||String(error).includes("P2002"))return reply.code(409).send({error:"category_slug_exists"});throw error}
  });

  app.put("/admin/categories/:id",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=categoryBody.safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_category"});
    const existing=await prisma.category.findUnique({where:{id:params.data.id}});if(!existing)return reply.code(404).send({error:"category_not_found"});
    if(await wouldCreateCycle(existing.id,body.data.parentId))return reply.code(400).send({error:"category_cycle"});
    if(body.data.parentId){const parent=await prisma.category.findUnique({where:{id:body.data.parentId}});if(!parent)return reply.code(400).send({error:"parent_not_found"});}
    try{
      const updated=await prisma.category.update({where:{id:existing.id},data:body.data});
      await audit(request,"CATEGORY_UPDATED",updated.id,{before:{name:existing.name,slug:existing.slug,parentId:existing.parentId,isActive:existing.isActive,sortOrder:existing.sortOrder},after:body.data});
      return reply.send({category:updated});
    }catch(error){if(String(error).includes("Unique constraint")||String(error).includes("P2002"))return reply.code(409).send({error:"category_slug_exists"});throw error}
  });

  app.put("/admin/categories/order",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const body=z.object({items:z.array(z.object({id:z.string().min(1),sortOrder:z.number().int().min(-10000).max(10000)})).min(1).max(300)}).safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:"invalid_order"});
    await prisma.$transaction(body.data.items.map(item=>prisma.category.update({where:{id:item.id},data:{sortOrder:item.sortOrder}})));
    await audit(request,"CATEGORY_ORDER_UPDATED","bulk",{count:body.data.items.length});
    return reply.send({saved:true});
  });



  app.get("/admin/categories/:id/attributes",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_category"});
    const category=await prisma.category.findUnique({where:{id:params.data.id},select:{id:true,name:true,slug:true}});if(!category)return reply.code(404).send({error:"category_not_found"});
    const attributes=await prisma.categoryAttribute.findMany({where:{categoryId:category.id},include:{options:{orderBy:{sortOrder:"asc"}},_count:{select:{values:true}}},orderBy:[{sortOrder:"asc"},{label:"asc"}]});
    return reply.send({category,attributes:attributes.map(a=>({id:a.id,key:a.key,label:a.label,type:a.type,unit:a.unit,required:a.required,filterable:a.filterable,searchable:a.searchable,sortOrder:a.sortOrder,config:a.config,options:a.options,valueCount:a._count.values}))});
  });

  const attributeBody=z.object({
    key:z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_]*$/),label:z.string().trim().min(1).max(120),type:z.enum(["TEXT","NUMBER","BOOLEAN","SELECT","MULTISELECT","DATE"]),unit:z.string().trim().max(30).nullable().default(null),required:z.boolean().default(false),filterable:z.boolean().default(true),searchable:z.boolean().default(false),sortOrder:z.number().int().min(-10000).max(10000).default(0),config:z.record(z.string(),z.unknown()).nullable().default(null),options:z.array(z.object({value:z.string().trim().min(1).max(120),label:z.string().trim().min(1).max(120),sortOrder:z.number().int().min(-10000).max(10000).default(0)})).max(150).default([]),
  }).superRefine((value,ctx)=>{if(["SELECT","MULTISELECT"].includes(value.type)&&value.options.length===0)ctx.addIssue({code:"custom",message:"options_required",path:["options"]});if(!["SELECT","MULTISELECT"].includes(value.type)&&value.options.length>0)ctx.addIssue({code:"custom",message:"options_not_allowed",path:["options"]});if(new Set(value.options.map(o=>o.value)).size!==value.options.length)ctx.addIssue({code:"custom",message:"duplicate_option",path:["options"]})});

  app.post("/admin/categories/:id/attributes",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=attributeBody.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_attribute",details:body.success?undefined:body.error.flatten()});
    const category=await prisma.category.findUnique({where:{id:params.data.id}});if(!category)return reply.code(404).send({error:"category_not_found"});
    try{const created=await prisma.$transaction(async tx=>{const a=await tx.categoryAttribute.create({data:{categoryId:category.id,key:body.data.key,label:body.data.label,type:body.data.type,unit:body.data.unit,required:body.data.required,filterable:body.data.filterable,searchable:body.data.searchable,sortOrder:body.data.sortOrder,config:body.data.config===null?Prisma.JsonNull:(body.data.config as Prisma.InputJsonValue)}});if(body.data.options.length)await tx.categoryAttributeOption.createMany({data:body.data.options.map(o=>({attributeId:a.id,value:o.value,label:o.label,sortOrder:o.sortOrder}))});return a});await audit(request,"CATEGORY_ATTRIBUTE_CREATED",created.id,{categoryId:category.id,key:created.key});return reply.code(201).send({attribute:created})}catch(error){if(String(error).includes("P2002")||String(error).includes("Unique constraint"))return reply.code(409).send({error:"attribute_key_exists"});throw error}
  });

  app.put("/admin/category-attributes/:id",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=attributeBody.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_attribute",details:body.success?undefined:body.error.flatten()});
    const current=await prisma.categoryAttribute.findUnique({where:{id:params.data.id},include:{_count:{select:{values:true}}}});if(!current)return reply.code(404).send({error:"attribute_not_found"});
    if(current._count.values>0&&current.type!==body.data.type)return reply.code(409).send({error:"attribute_type_in_use",count:current._count.values});
    if(current._count.values>0&&["SELECT","MULTISELECT"].includes(current.type)){
      const values=await prisma.listingAttributeValue.findMany({where:{attributeId:current.id},select:{valueText:true,valueJson:true}});const used=new Set<string>();for(const value of values){if(value.valueText)used.add(value.valueText);if(Array.isArray(value.valueJson))for(const item of value.valueJson)if(typeof item==="string")used.add(item)}const allowed=new Set(body.data.options.map(o=>o.value));const missing=[...used].filter(v=>!allowed.has(v));if(missing.length)return reply.code(409).send({error:"attribute_option_in_use",values:missing.slice(0,20)});
    }
    try{await prisma.$transaction(async tx=>{await tx.categoryAttribute.update({where:{id:current.id},data:{key:body.data.key,label:body.data.label,type:body.data.type,unit:body.data.unit,required:body.data.required,filterable:body.data.filterable,searchable:body.data.searchable,sortOrder:body.data.sortOrder,config:body.data.config===null?Prisma.JsonNull:(body.data.config as Prisma.InputJsonValue)}});await tx.categoryAttributeOption.deleteMany({where:{attributeId:current.id}});if(body.data.options.length)await tx.categoryAttributeOption.createMany({data:body.data.options.map(o=>({attributeId:current.id,value:o.value,label:o.label,sortOrder:o.sortOrder}))})});await audit(request,"CATEGORY_ATTRIBUTE_UPDATED",current.id,{categoryId:current.categoryId,key:body.data.key,valueCount:current._count.values});return reply.send({saved:true})}catch(error){if(String(error).includes("P2002")||String(error).includes("Unique constraint"))return reply.code(409).send({error:"attribute_key_exists"});throw error}
  });

  app.delete("/admin/category-attributes/:id",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_attribute"});const attr=await prisma.categoryAttribute.findUnique({where:{id:params.data.id},include:{_count:{select:{values:true}}}});if(!attr)return reply.code(404).send({error:"attribute_not_found"});if(attr._count.values>0)return reply.code(409).send({error:"attribute_in_use",count:attr._count.values});await prisma.categoryAttribute.delete({where:{id:attr.id}});await audit(request,"CATEGORY_ATTRIBUTE_DELETED",attr.id,{categoryId:attr.categoryId,key:attr.key});return reply.code(204).send();
  });

  app.delete("/admin/categories/:id",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_category"});
    const category=await prisma.category.findUnique({where:{id:params.data.id},include:{_count:{select:{children:true,listings:true}}}});if(!category)return reply.code(404).send({error:"category_not_found"});
    if(category._count.children>0)return reply.code(409).send({error:"category_has_children",count:category._count.children});
    if(category._count.listings>0)return reply.code(409).send({error:"category_has_listings",count:category._count.listings});
    await prisma.category.delete({where:{id:category.id}});await audit(request,"CATEGORY_DELETED",category.id,{name:category.name,slug:category.slug});
    return reply.code(204).send();
  });
}
