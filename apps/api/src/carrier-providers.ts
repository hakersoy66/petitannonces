import { randomUUID } from "node:crypto";

export type CarrierCode = "MONDIAL_RELAY" | "COLISSIMO";
export type AddressInput = { name:string; address1:string; address2?:string; postalCode:string; city:string; countryCode:string; phone?:string; email?:string };
export type LabelRequest = { orderId:string; carrier:CarrierCode; service:string; weightG:number; lengthCm?:number; widthCm?:number; heightCm?:number; relayPointId?:string; sender:AddressInput; recipient:AddressInput };
export type LabelResult = { provider:string; trackingNumber:string; trackingUrl:string; labelUrl:string; service:string; relayPointId?:string|null; sandbox:boolean };
export type RelayPoint = { id:string; name:string; address1:string; postalCode:string; city:string; countryCode:string; distanceM?:number };

function mockLabel(input:LabelRequest):LabelResult {
  const suffix=randomUUID().replaceAll("-","").slice(0,12).toUpperCase();
  const tracking=input.carrier==="MONDIAL_RELAY"?`MR${suffix}`:`8R${suffix}`;
  return {provider:input.carrier,trackingNumber:tracking,trackingUrl:`https://www.petitannonces.fr/suivi/${tracking}`,labelUrl:`https://www.petitannonces.fr/mock-labels/${tracking}.pdf`,service:input.service,relayPointId:input.relayPointId??null,sandbox:true};
}

async function colissimoLabel(input:LabelRequest):Promise<LabelResult>{
  const apiKey=process.env.COLISSIMO_API_KEY;
  if(!apiKey) return mockLabel(input);
  const endpoint=process.env.COLISSIMO_GENERATE_LABEL_URL??"https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/2.0/generateLabel";
  const payload={outputFormat:{outputPrintingType:"PDF_A4_300dpi",returnType:"URL"},letter:{service:{productCode:input.service||"DOM",depositDate:new Date().toISOString().slice(0,10)},parcel:{weight:input.weightG/1000},sender:{address:{companyName:input.sender.name,line2:input.sender.address1,line3:input.sender.address2,zipCode:input.sender.postalCode,city:input.sender.city,countryCode:input.sender.countryCode,phoneNumber:input.sender.phone,email:input.sender.email}},addressee:{address:{companyName:input.recipient.name,line2:input.recipient.address1,line3:input.recipient.address2,zipCode:input.recipient.postalCode,city:input.recipient.city,countryCode:input.recipient.countryCode,phoneNumber:input.recipient.phone,email:input.recipient.email}}}};
  const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","X-Okapi-Key":apiKey},body:JSON.stringify(payload)});
  if(!response.ok) throw new Error(`colissimo_label_error_${response.status}`);
  const data:any=await response.json();
  const tracking=String(data.parcelNumber??data.labelResponse?.parcelNumber??"");
  const label=String(data.labelResponse?.pdfUrl??data.pdfUrl??"");
  if(!tracking||!label) throw new Error("colissimo_label_incomplete");
  return {provider:"COLISSIMO",trackingNumber:tracking,trackingUrl:`https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(tracking)}`,labelUrl:label,service:input.service,sandbox:false};
}

async function mondialRelayLabel(input:LabelRequest):Promise<LabelResult>{
  const endpoint=process.env.MONDIAL_RELAY_LABEL_PROXY_URL;
  const token=process.env.MONDIAL_RELAY_LABEL_PROXY_TOKEN;
  if(!endpoint||!token) return mockLabel(input);
  const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(input)});
  if(!response.ok) throw new Error(`mondial_relay_label_error_${response.status}`);
  const data:any=await response.json();
  if(!data.trackingNumber||!data.labelUrl) throw new Error("mondial_relay_label_incomplete");
  return {provider:"MONDIAL_RELAY",trackingNumber:String(data.trackingNumber),trackingUrl:String(data.trackingUrl??`https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=${encodeURIComponent(String(data.trackingNumber))}`),labelUrl:String(data.labelUrl),service:input.service,relayPointId:input.relayPointId??null,sandbox:Boolean(data.sandbox)};
}

export async function generateCarrierLabel(input:LabelRequest){return input.carrier==="COLISSIMO"?colissimoLabel(input):mondialRelayLabel(input)}

export async function searchRelayPoints(carrier:CarrierCode,postalCode:string,countryCode:string):Promise<RelayPoint[]>{
  if(carrier!=="MONDIAL_RELAY") return [];
  const endpoint=process.env.MONDIAL_RELAY_RELAY_PROXY_URL;
  const token=process.env.MONDIAL_RELAY_LABEL_PROXY_TOKEN;
  if(endpoint&&token){const r=await fetch(`${endpoint}?postalCode=${encodeURIComponent(postalCode)}&countryCode=${encodeURIComponent(countryCode)}`,{headers:{authorization:`Bearer ${token}`}});if(r.ok){const d:any=await r.json();return Array.isArray(d.points)?d.points:[]}}
  return [1,2,3].map((n)=>({id:`MOCK-${postalCode}-${n}`,name:`Point Relais ${n}`,address1:`${n*10} rue du Commerce`,postalCode,city:"À proximité",countryCode,distanceM:n*450}));
}
