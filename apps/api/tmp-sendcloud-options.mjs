import { getShippingOptions } from './dist/carrier-providers.js';
const r=await getShippingOptions({weightG:1000,sender:{name:'Seller',address1:'1 rue de Paris',postalCode:'42000',city:'Saint-Etienne',countryCode:'FR'},recipient:{name:'Buyer',address1:'1 rue de la Republique',postalCode:'69003',city:'Lyon',countryCode:'FR'}});
console.log(JSON.stringify(r.options.map(x=>({code:x.code,name:x.name,carrier:x.carrierName,priceMinor:x.priceMinor,servicePoint:x.servicePoint})),null,2));
