import { randomUUID } from "node:crypto";

export type AddressInput = { name:string; address1:string; address2?:string; postalCode:string; city:string; countryCode:string; phone?:string; email?:string };
export type ShippingQuoteRequest = { weightG:number; lengthCm?:number; widthCm?:number; heightCm?:number; sender:AddressInput; recipient:AddressInput; servicePointId?:string };
export type ShippingOption = { code:string; name:string; carrierCode:string; carrierName:string; priceMinor:number; currency:string; servicePoint:boolean; contractId?:number };
export type LabelRequest = ShippingQuoteRequest & { orderId:string; shippingOptionCode:string; contractId?:number };
export type LabelResult = { provider:"SENDCLOUD"; carrierCode?:string; trackingNumber:string; trackingUrl:string; labelUrl:string; shippingOptionCode:string; servicePointId?:string|null; sandbox:boolean };
export type ServicePoint = { id:string; name:string; address1:string; postalCode:string; city:string; countryCode:string; carrierCode?:string; distanceM?:number };

const V3_BASE=(process.env.SENDCLOUD_API_V3_URL??"https://panel.sendcloud.sc/api/v3").replace(/\/$/,"");
const SERVICE_POINTS_BASE=(process.env.SENDCLOUD_SERVICE_POINTS_URL??"https://servicepoints.sendcloud.sc/api/v2").replace(/\/$/,"");

function authHeader(){const pub=process.env.SENDCLOUD_PUBLIC_KEY;const priv=process.env.SENDCLOUD_PRIVATE_KEY;if(!pub||!priv)return null;return `Basic ${Buffer.from(`${pub}:${priv}`).toString("base64")}`}
function minor(value:unknown){const n=Number(value);return Number.isFinite(n)?Math.round(n*100):0}

export async function getShippingOptions(input:ShippingQuoteRequest):Promise<{options:ShippingOption[];sandbox:boolean}>{
 const auth=authHeader();
 if(!auth){
  const options:ShippingOption[]=[
   {code:"mock:service-point",name:"Livraison en point relais",carrierCode:"mock",carrierName:"Sendcloud Sandbox",priceMinor:399,currency:"EUR",servicePoint:true},
   {code:"mock:home",name:"Livraison à domicile",carrierCode:"mock",carrierName:"Sendcloud Sandbox",priceMinor:649,currency:"EUR",servicePoint:false},
  ];
  return {options,sandbox:true};
 }
 const body:any={from_country_code:input.sender.countryCode,to_country_code:input.recipient.countryCode,from_postal_code:input.sender.postalCode,to_postal_code:input.recipient.postalCode,parcels:[{weight:{value:String(input.weightG/1000),unit:"kg"}}]};
 if(input.lengthCm&&input.widthCm&&input.heightCm)body.parcels[0].dimensions={length:String(input.lengthCm),width:String(input.widthCm),height:String(input.heightCm),unit:"cm"};
 if(input.servicePointId)body.to_service_point_id=input.servicePointId;
 const response=await fetch(`${V3_BASE}/shipping-options`,{method:"POST",headers:{authorization:auth,"content-type":"application/json"},body:JSON.stringify(body)});
 if(!response.ok)throw new Error(`sendcloud_shipping_options_${response.status}`);
 const json:any=await response.json();
 const rows=Array.isArray(json.data)?json.data:[];
 const options=rows.map((row:any)=>({code:String(row.code),name:String(row.name??row.product?.name??row.code),carrierCode:String(row.carrier?.code??""),carrierName:String(row.carrier?.name??row.carrier?.code??"Sendcloud"),priceMinor:minor(row.quote?.price?.value??row.price?.value??row.price),currency:String(row.quote?.price?.currency??row.price?.currency??"EUR"),servicePoint:String(row.functionalities?.last_mile??"")==="service_point",contractId:row.contract_id?Number(row.contract_id):undefined})).filter((x:ShippingOption)=>x.code&&x.priceMinor>=0);
 return {options,sandbox:false};
}

export async function searchServicePoints(postalCode:string,countryCode:string,carrierCode?:string):Promise<ServicePoint[]>{
 const auth=authHeader();
 if(!auth)return [1,2,3].map((n)=>({id:`MOCK-SP-${postalCode}-${n}`,name:`Point relais ${n}`,address1:`${n*10} rue du Commerce`,postalCode,city:"À proximité",countryCode,carrierCode:"mock",distanceM:n*450}));
 const qs=new URLSearchParams({country:countryCode,address:postalCode,radius:"5000"});if(carrierCode)qs.set("carrier",carrierCode);
 const response=await fetch(`${SERVICE_POINTS_BASE}/service-points?${qs.toString()}`,{headers:{authorization:auth}});
 if(!response.ok)throw new Error(`sendcloud_service_points_${response.status}`);
 const rows:any[]=await response.json();
 return (Array.isArray(rows)?rows:[]).map((p:any)=>({id:String(p.id),name:String(p.name??p.company_name??"Point relais"),address1:String(p.street??p.address??""),postalCode:String(p.postal_code??postalCode),city:String(p.city??""),countryCode:String(p.country??countryCode),carrierCode:String(p.carrier??""),distanceM:p.distance?Number(p.distance):undefined}));
}

export async function generateCarrierLabel(input:LabelRequest):Promise<LabelResult>{
 const auth=authHeader();
 if(!auth){const suffix=randomUUID().replaceAll("-","").slice(0,12).toUpperCase();const tracking=`SC${suffix}`;return {provider:"SENDCLOUD",carrierCode:"mock",trackingNumber:tracking,trackingUrl:`https://www.petitannonces.fr/suivi/${tracking}`,labelUrl:`https://www.petitannonces.fr/mock-labels/${tracking}.pdf`,shippingOptionCode:input.shippingOptionCode,servicePointId:input.servicePointId??null,sandbox:true}}
 const payload:any={label_details:{mime_type:"application/pdf",dpi:72},order_number:input.orderId,external_reference_id:input.orderId,to_address:{name:input.recipient.name,address_line_1:input.recipient.address1,address_line_2:input.recipient.address2??"",postal_code:input.recipient.postalCode,city:input.recipient.city,country_code:input.recipient.countryCode,phone_number:input.recipient.phone,email:input.recipient.email},from_address:{name:input.sender.name,address_line_1:input.sender.address1,address_line_2:input.sender.address2??"",postal_code:input.sender.postalCode,city:input.sender.city,country_code:input.sender.countryCode,phone_number:input.sender.phone,email:input.sender.email},ship_with:{type:"shipping_option_code",properties:{shipping_option_code:input.shippingOptionCode,...(input.contractId?{contract_id:input.contractId}:{})}},parcels:[{weight:{value:String(input.weightG/1000),unit:"kg"}}]};
 if(input.lengthCm&&input.widthCm&&input.heightCm)payload.parcels[0].dimensions={length:String(input.lengthCm),width:String(input.widthCm),height:String(input.heightCm),unit:"cm"};
 if(input.servicePointId)payload.to_service_point={id:input.servicePointId};
 const response=await fetch(`${V3_BASE}/shipments/announce`,{method:"POST",headers:{authorization:auth,"content-type":"application/json"},body:JSON.stringify(payload)});
 if(!response.ok)throw new Error(`sendcloud_label_${response.status}`);
 const json:any=await response.json();const data=json.data??json;const parcel=data.parcels?.[0]??{};const label=parcel.documents?.find((d:any)=>d.type==="label")?.link??parcel.label_file??"";const tracking=String(parcel.tracking_number??parcel.tracking_code??parcel.id??"");
 if(!tracking||!label)throw new Error("sendcloud_label_incomplete");
 return {provider:"SENDCLOUD",carrierCode:String(data.carrier?.code??""),trackingNumber:tracking,trackingUrl:String(parcel.tracking_url??""),labelUrl:String(label),shippingOptionCode:input.shippingOptionCode,servicePointId:input.servicePointId??null,sandbox:false};
}
