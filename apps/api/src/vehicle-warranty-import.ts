export type ImportedVehicleWarrantyHint={
  commercialMonths:number;
  commercialCoverage:string|null;
  commercialProvider:string|null;
  evidence:string;
};

function warrantyDuration(raw:string):number|null{
 const normalized=raw.replace(/\u00a0|\u202f/g," ").replace(/\s+/g," ").trim();
 // Match only an explicit duration tied to "garantie", not the car's age or legal notice.
 const before=normalized.match(/\bgaranti(?:e|es|s)?\b.{0,85}?\b(\d{1,2})\s*(mois|ans?|ann[ée]es?)\b/i);
 const after=normalized.match(/\b(\d{1,2})\s*(mois|ans?|ann[ée]es?)\b.{0,36}?\bgaranti(?:e|es|s)?\b/i);
 const m=before??after;if(!m)return null;
 const months=Number(m[1])*(m[2]?.toLowerCase().startsWith("mois")?1:12);
 return Number.isInteger(months)&&months>=1&&months<=60?months:null;
}

export function detectLeboncoinVehicleWarranty(rawDescription:string|null|undefined,attributes?:unknown,rawReader?:string|null):ImportedVehicleWarrantyHint|null{
 const candidates:string[]=[];
 if(attributes && typeof attributes==="object"){
  const ad=attributes as Record<string,unknown>;
  const groups=[ad.attributes,ad.ad_attributes,ad.params,(ad.vehicle as Record<string,unknown>|undefined)?.attributes];
  for(const group of groups){
   const items=Array.isArray(group)?group:group&&typeof group==="object"?Object.entries(group).map(([key,value])=>({key,value})):[];
   for(const item of items){
    if(!item||typeof item!=="object")continue;
    const a=item as Record<string,unknown>;
    const key=String(a.key??a.key_label??a.label??"");
    const label=String(a.key_label??a.label??key);
    if(!/garanti|warranty|coverage/i.test(key+" "+label))continue;
    const values=[a.value_label,a.value,Array.isArray(a.values)?a.values[0]:null];
    for(const v of values)if(typeof v==="string"||typeof v==="number")candidates.push("Garantie : "+String(v).slice(0,350));
   }
  }
 }
 const description=String(rawDescription??"");
 const reader=String(rawReader??"");
 const readerLines=reader.split(/\r?\n/).map(line=>line.replace(/[*#]/g,"").trim());
 for(let i=0;i<readerLines.length;i++){
  const line=readerLines[i]??"";
  if(/^garantie(?: du | de | )?(?:v[ée]hicule|commerciale)?\s*:?\s*$/i.test(line) && readerLines[i+1])candidates.push("Garantie : "+readerLines[i+1]);
  else if(/^garantie(?: du | de | )?(?:v[ée]hicule|commerciale)?\s*[:：]\s*.+/i.test(line))candidates.push(line);
 }
 for(const source of [description,reader]){
  for(const segment of source.split(/[.!?\n\r•]/).slice(0,300)){
   const t=segment.replace(/\s+/g," ").trim();
   if(t.length<8||t.length>650||!/garanti(?:e|es|s)?\b/i.test(t))continue;
   candidates.push(t);
  }
 }
 for(const candidate of candidates){
  const statement=candidate.replace(/\s+/g," ").trim();
  if(/\b(?:garantie\s+l[ée]gale|garantie\s+de\s+conformit[ée]|vices?\s+cach[ée]s?|garantie\s+(?:du\s+)?constructeur|garantie\s+fabricant)\b/i.test(statement))continue;
  if(/\b(?:sans\s+garantie|aucune\s+garantie|pas\s+de\s+garantie|non\s+garanti)\b/i.test(statement))continue;
  const months=warrantyDuration(statement);
  if(months===null)continue;
  const explicitCoverage=/\b(?:moteur|bo[iî]te(?:s)?\s+(?:de\s+)?vitesse|m[ée]canique|pi[eè]ces?\s+(?:et\s+)?main[\s-]+d['’]?[œo]euvre|embrayage|transmission|turbo(?:compresseur)?|panne(?:s)?\s+m[ée]canique)\b/i.test(statement);
  return {commercialMonths:months,commercialCoverage:explicitCoverage?statement.slice(0,1000):null,commercialProvider:null,evidence:statement.slice(0,350)};
 }
 return null;
}
