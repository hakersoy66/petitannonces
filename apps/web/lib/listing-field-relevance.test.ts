import test from "node:test";
import assert from "node:assert/strict";
import {fixedListingFieldValue,listingFieldRelevant,relevantListingOptions} from "./listing-field-relevance";

function relevant(slug:string,key:string,optionKey?:string,optionValue?:string){
 const fields=optionKey?[{id:"selector",key:optionKey,required:true},{id:"item",key,required:false}]:[{id:"item",key,required:false}];
 const values=optionKey?{selector:optionValue}:{};
 return listingFieldRelevant({slug,domain:"GENERAL",fields,values},{id:"item",key,required:false});
}
test("motorcycles and scooters do not request car-specific doors, seats and fiscal horsepower",()=>{
 for(const slug of ["motos","scooters"])for(const key of ["doors","seats","fiscalPower","bodyStyle"])assert.equal(relevant(slug,key),false,slug+key);
 assert.equal(relevant("motos","engineSize"),true);
 assert.equal(relevant("voitures-citadines","doors"),true);
});
test("electric vehicle fuel and transmission are not re-asked; hybrid fuel options are constrained",()=>{
 assert.equal(fixedListingFieldValue("voitures-electriques","fuel"),"Électrique");
 assert.equal(relevant("voitures-electriques","fuel"),false);
 assert.equal(relevant("voitures-electriques","gearbox"),false);
 const options=["Essence","Diesel","Hybride","Hybride rechargeable","Électrique"].map((value,id)=>({id:String(id),label:value,value}));
 assert.deepEqual(relevantListingOptions({slug:"voitures-hybrides",domain:"VEHICLE",fields:[],values:{}},"fuel",options).map(x=>x.value),["Hybride","Hybride rechargeable"]);
 assert.deepEqual(relevantListingOptions({slug:"scooters",domain:"VEHICLE",fields:[],values:{}},"fuel",options).map(x=>x.value),["Essence","Électrique"]);
});
test("fixed-brand phones and known appliances do not ask for redundant brand/appliance types",()=>{
 assert.equal(fixedListingFieldValue("apple-iphone","brand"),"Apple");
 assert.equal(fixedListingFieldValue("samsung-galaxy","brand"),"Samsung");
 assert.equal(relevant("apple-iphone","brand"),false);
 assert.equal(relevant("samsung-galaxy","model"),true);
 assert.equal(fixedListingFieldValue("lave-linge","appliance"),"Lave-linge");
 assert.equal(relevant("fours-plaques","appliance"),false);
 assert.equal(relevant("electromenager","appliance"),true);
});
test("broad phone family adapts to fixed lines, smartwatches and smartphones",()=>{
 assert.equal(relevant("telephones-smartphones","storage","deviceType","Téléphone fixe"),false);
 assert.equal(relevant("telephones-smartphones","dualSim","deviceType","Montre connectée"),false);
 assert.equal(relevant("telephones-smartphones","network","deviceType","Smartphone"),true);
 assert.equal(relevant("telephones-smartphones","deviceType","deviceType","Smartphone"),true);
});
test("media family only requests video/camera specs when appropriate",()=>{
 assert.equal(relevant("photo-video","screenSize","imageSoundProduct","Casque"),false);
 assert.equal(relevant("photo-video","cameraType","imageSoundProduct","Caméra"),true);
 assert.equal(relevant("photo-video","cameraType","imageSoundProduct","Télévision"),false);
 assert.equal(relevant("photo-video","resolution","imageSoundProduct","Télévision"),true);
 assert.equal(relevant("photo-video","resolution","imageSoundProduct","Objectif / Lentille"),false);
});
test("computers, gaming accessories, books and jobs keep appropriate fields",()=>{
 assert.equal(relevant("ordinateurs","screenSize","computerType","PC fixe"),false);
 assert.equal(relevant("ordinateurs","screenSize","computerType","Portable"),true);
 assert.equal(relevant("consoles","storage","videoGameType","Accessoires"),false);
 assert.equal(relevant("consoles","platform","videoGameType","Accessoires"),true);
 assert.equal(relevant("emploi-btp","contract"),true);
 assert.equal(relevant("livres-bd","author"),true);
});

test("console platform choices reflect the selected brand",()=>{
 const options=["PS5","Switch","Xbox Series X","Steam Deck","Autre"].map((value,id)=>({id:String(id),value,label:value}));
 const fields=[{id:"brand",key:"brand",required:true}];
 const forBrand=(brand:string)=>relevantListingOptions({slug:"consoles",domain:"GENERAL",fields,values:{brand}},"platform",options).map(x=>x.value);
 assert.deepEqual(forBrand("Sony"),["PS5","Autre"]);
 assert.deepEqual(forBrand("Nintendo"),["Switch","Autre"]);
 assert.deepEqual(forBrand("Microsoft"),["Xbox Series X","Autre"]);
 assert.deepEqual(forBrand("Valve"),["Steam Deck","Autre"]);
});
