import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@pa/database";

type LegacyCategory={legacyId:string;name:string;slug?:string;parentLegacyId?:string|null};
const args=process.argv.slice(2);const val=(k:string)=>{const i=args.indexOf(k);return i>=0?args[i+1]:undefined};
const input=val("--input"), output=val("--output");
if(args.includes("--help")||!input){console.log("Usage: pnpm exec tsx scripts/flynax-category-map.ts --input categories.ndjson [--output category-map.suggested.json]");process.exit(args.includes("--help")?0:2)}
const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tokens=(s:string)=>new Set(norm(s).split(/\s+/).filter(Boolean));
const similarity=(a:string,b:string)=>{const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let hit=0;for(const x of A)if(B.has(x))hit++;return hit/Math.max(A.size,B.size)};
const rows=(await readFile(resolve(input),"utf8")).split(/\r?\n/).filter(Boolean).map((x,i)=>{try{return JSON.parse(x) as LegacyCategory}catch{throw new Error(`categories.ndjson:${i+1}:invalid_json`)}});
const current=await prisma.category.findMany({where:{isActive:true},select:{slug:true,name:true,parent:{select:{name:true}},parentId:true}});
const map:Record<string,string>={}, review:Array<{legacyId:string;legacy:string;suggested:string|null;confidence:number;reason:string}>=[];
for(const row of rows){
 const legacyName=row.name??"";const legacySlug=row.slug??"";let best:{slug:string;score:number;reason:string}|null=null;
 for(const c of current){
   const exactSlug=legacySlug&&norm(legacySlug)===norm(c.slug);const exactName=norm(legacyName)===norm(c.name);
   const score=exactSlug?1:exactName?.98:Math.max(similarity(legacyName,c.name), similarity(`${legacyName} ${legacySlug}`,`${c.parent?.name??""} ${c.name} ${c.slug}`));
   const reason=exactSlug?"exact_slug":exactName?"exact_name":"token_similarity";
   if(!best||score>best.score)best={slug:c.slug,score,reason};
 }
 if(best&&best.score>=0.72){map[row.legacyId]=best.slug;review.push({legacyId:row.legacyId,legacy:legacyName,suggested:best.slug,confidence:Number(best.score.toFixed(2)),reason:best.reason});}
 else review.push({legacyId:row.legacyId,legacy:legacyName,suggested:best?.slug??null,confidence:Number((best?.score??0).toFixed(2)),reason:"manual_review"});
}
const result={generatedAt:new Date().toISOString(),mapped:Object.keys(map).length,total:rows.length,map,review};
if(output)await writeFile(resolve(output),JSON.stringify(map,null,2)+"\n","utf8");
console.log(JSON.stringify(result,null,2));await prisma.$disconnect();
