import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyReply } from 'fastify';
const BASE='/var/www/petitannonces/shared/private/sensitive-evidence';
function securePath(key:string){
 if(!/^private\/(?:disputes|vacation-incidents|pro-business)\/[a-zA-Z0-9_-]{5,100}\/[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp|pdf)$/.test(key))throw new Error('invalid_private_evidence_key');
 const file=resolve(BASE,key);
 if(!file.startsWith(BASE+'/'))throw new Error('invalid_private_evidence_key');return file;
}
export async function saveSensitiveEvidence(key:string,body:Buffer){
 const file=securePath(key);await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});await writeFile(file,body,{flag:'wx',mode:0o600});
}
export async function removeSensitiveEvidence(key:string){await unlink(securePath(key))}
// Inline admin-only review of uploaded Kbis/identity documents. Download
// behavior remains unchanged for other private evidence (disputes, etc.).
export async function previewSensitiveEvidence(reply:FastifyReply,key:string,mimeType:string){
 const mime=(["application/pdf","image/jpeg","image/png"] as const).find(value=>value===mimeType);
 if(!mime) return reply.code(415).send({error:'unsupported_preview_type'});
 const bytes=await readFile(securePath(key));
 reply.header('Content-Type',mime);
 reply.header('Content-Disposition','inline');
 reply.header('Cache-Control','private, no-store, max-age=0');
 reply.header('Pragma','no-cache');
 reply.header('X-Content-Type-Options','nosniff');
 reply.header('Referrer-Policy','no-referrer');
 reply.header('Cross-Origin-Resource-Policy','same-origin');
 return reply.send(bytes);
}

export async function downloadSensitiveEvidence(reply:FastifyReply,key:string,name:string){
 const bytes=await readFile(securePath(key));
 const safe=name.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,130);
 reply.header('Content-Type','application/octet-stream');
 reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(safe)}`);
 reply.header('Cache-Control','private, no-store');
 reply.header('X-Content-Type-Options','nosniff');
 return reply.send(bytes);
}
