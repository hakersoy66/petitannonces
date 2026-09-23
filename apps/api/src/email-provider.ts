import { randomUUID } from "node:crypto";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { getRuntimeIntegration } from "./admin-control.js";

export type ApplicationEmail = {
  to:string;
  subject:string;
  html:string;
  text:string;
  from?:string;
  replyTo?:string;
  headers?:Record<string,string>;
  idempotencyKey?:string;
  tags?:Array<{name:string;value:string}>;
};

export type EmailProviderName="hostinger_smtp"|"sendmail";
export type EmailSendResult={provider:EmailProviderName;providerMessageId:string|null;deliveryStatus:"ACCEPTED"};

function cleanHeader(value:string){return value.replace(/[\r\n]+/g," ").trim()}
function encodeHeader(value:string){return `=?UTF-8?B?${Buffer.from(value,"utf8").toString("base64")}?=`}
function extractAddress(value:string){const match=value.match(/<([^<>\s]+@[^<>\s]+)>/);return (match?.[1]??value).trim()}
function base64Lines(value:string){return Buffer.from(value,"utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n")??""}
function escapeSmtpData(value:string){return value.replace(/\r?\n/g,"\r\n").replace(/^\./gm,"..");}

type SmtpConfig={host:string;user:string;pass:string;from:string;port:number;secure:boolean};

async function smtpRuntime():Promise<SmtpConfig|null>{
  const runtime=await getRuntimeIntegration("hostinger-mail");
  if(runtime?.enabled){
    const host=String(runtime.config.host??"smtp.hostinger.com").trim();
    const user=String(runtime.config.user??"noreply@petitannonces.fr").trim();
    const pass=String(runtime.secrets.password??"").trim();
    const from=String(runtime.config.from??process.env.EMAIL_FROM??"Petit Annonces <noreply@petitannonces.fr>").trim();
    const port=Number(runtime.config.port??465);
    const secure=String(runtime.config.secure??"true").toLowerCase()!=="false";
    if(host&&user&&pass&&from&&Number.isFinite(port))return{host,user,pass,from,port,secure};
  }
  const host=String(process.env.SMTP_HOST??"").trim();
  const user=String(process.env.SMTP_USER??"").trim();
  const pass=String(process.env.SMTP_PASS??"").trim();
  const from=String(process.env.SMTP_FROM??process.env.EMAIL_FROM??"").trim();
  const port=Number(process.env.SMTP_PORT??465);
  const secure=String(process.env.SMTP_SECURE??"true").toLowerCase()!=="false";
  if(!host||!user||!pass||!from||!Number.isFinite(port))return null;
  return{host,user,pass,from,port,secure};
}

type PendingResponse={resolve:(value:string)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
function responseEnd(buffer:string){
  let pos=0;let code:string|null=null;
  while(true){
    const end=buffer.indexOf("\r\n",pos);if(end<0)return null;
    const line=buffer.slice(pos,end);
    const match=line.match(/^(\d{3})([- ])/);
    if(!code&&match)code=match[1]!;
    if(code&&line.startsWith(`${code} `))return end+2;
    pos=end+2;
  }
}

async function smtpSendSecure(config:SmtpConfig,message:ApplicationEmail):Promise<EmailSendResult>{
  if(!config.secure)throw new Error("smtp_starttls_not_supported_use_port_465_secure_true");
  const socket:TLSSocket=tlsConnect({host:config.host,port:config.port,servername:config.host,rejectUnauthorized:true});
  socket.setEncoding("utf8");
  let buffer="";let fatal:Error|null=null;const queued:string[]=[];const waiting:PendingResponse[]=[];
  const rejectAll=(error:Error)=>{fatal=error;while(waiting.length){const item=waiting.shift()!;clearTimeout(item.timer);item.reject(error)}};
  const pump=()=>{while(true){const end=responseEnd(buffer);if(end==null)return;const response=buffer.slice(0,end);buffer=buffer.slice(end);const item=waiting.shift();if(item){clearTimeout(item.timer);item.resolve(response)}else queued.push(response)}};
  socket.on("data",chunk=>{buffer+=String(chunk);pump()});
  socket.on("error",error=>rejectAll(error instanceof Error?error:new Error("smtp_socket_error")));
  socket.on("close",()=>{if(waiting.length)rejectAll(new Error("smtp_connection_closed"))});
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("smtp_connect_timeout")),10000);socket.once("secureConnect",()=>{clearTimeout(timer);resolve()});socket.once("error",error=>{clearTimeout(timer);reject(error)})});
  const nextResponse=()=>{if(fatal)return Promise.reject(fatal);if(queued.length)return Promise.resolve(queued.shift()!);return new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>{const idx=waiting.findIndex(x=>x.timer===timer);if(idx>=0)waiting.splice(idx,1);reject(new Error("smtp_response_timeout"))},12000);waiting.push({resolve,reject,timer})})};
  const expect=(response:string,codes:number[])=>{const lines=response.trim().split(/\r?\n/);const last=lines[lines.length-1]??"";const code=Number(last.slice(0,3));if(!codes.includes(code))throw new Error(`smtp_${code||"invalid"}_${last.slice(0,180)}`)};
  const command=async(cmd:string,codes:number[])=>{socket.write(`${cmd}\r\n`);const response=await nextResponse();expect(response,codes);return response};
  try{
    expect(await nextResponse(),[220]);
    await command("EHLO petitannonces.fr",[250]);
    await command("AUTH LOGIN",[334]);
    await command(Buffer.from(config.user,"utf8").toString("base64"),[334]);
    await command(Buffer.from(config.pass,"utf8").toString("base64"),[235]);
    const from=cleanHeader(message.from??config.from);
    const envelopeFrom=extractAddress(config.user);
    await command(`MAIL FROM:<${envelopeFrom}>`,[250]);
    await command(`RCPT TO:<${extractAddress(message.to)}>`,[250,251]);
    await command("DATA",[354]);
    const boundary=`pa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const customHeaders=Object.entries(message.headers??{}).map(([key,value])=>`${cleanHeader(key)}: ${cleanHeader(value)}`);
    const mime=[
      `From: ${from}`,
      `To: ${cleanHeader(message.to)}`,
      `Subject: ${encodeHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@petitannonces.fr>`,
      ...(message.replyTo?[`Reply-To: ${cleanHeader(message.replyTo)}`]:[]),
      ...customHeaders,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
      "Auto-Submitted: auto-generated",
      "X-Auto-Response-Suppress: All",
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(message.text),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(message.html),
      `--${boundary}--`,
      "",
    ].join("\r\n");
    socket.write(`${escapeSmtpData(mime)}\r\n.\r\n`);
    expect(await nextResponse(),[250]);
    await command("QUIT",[221]).catch(()=>undefined);
    return{provider:"hostinger_smtp",providerMessageId:null,deliveryStatus:"ACCEPTED"};
  }finally{socket.end()}
}

export async function sendApplicationEmail(message:ApplicationEmail):Promise<EmailSendResult>{
  const smtp=await smtpRuntime();
  if(!smtp)throw new Error("hostinger_smtp_not_configured");
  return smtpSendSecure(smtp,message);
}


export async function sendHostingerSmtpOnly(message:ApplicationEmail):Promise<EmailSendResult>{
  const smtp=await smtpRuntime();
  if(!smtp)throw new Error("hostinger_smtp_not_configured");
  return smtpSendSecure(smtp,message);
}

export async function getEmailProviderStatus(){
  const smtp=await smtpRuntime();
  return{primary:smtp?"hostinger_smtp":"unconfigured",smtpConfigured:Boolean(smtp),fromConfigured:Boolean(smtp?.from)} as const;
}
