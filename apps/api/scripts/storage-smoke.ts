import { uploadStoredObject, deleteStoredObject, storageConfigured } from "../src/storage.js";
const key=`qa/wizard-media-${Date.now()}.png`;
const body=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK0sAAAAASUVORK5CYII=","base64");
if(!storageConfigured())throw new Error("storage_not_configured");
const url=await uploadStoredObject(key,"image/png",body);
console.log(JSON.stringify({configured:true,uploaded:Boolean(url)}));
await deleteStoredObject(key);
console.log(JSON.stringify({deleted:true}));

[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]