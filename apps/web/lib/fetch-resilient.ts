export async function fetchWithTimeout(input:RequestInfo|URL,init:RequestInit={},timeoutMs=7000){
  const controller=new AbortController();
  const timer=globalThis.setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(input,{...init,signal:controller.signal})}
  finally{globalThis.clearTimeout(timer)}
}

export async function fetchWithRetry(input:RequestInfo|URL,init:RequestInit={},options:{timeoutMs?:number;retries?:number;delayMs?:number}={}){
  const timeoutMs=options.timeoutMs??7000;
  const retries=Math.max(0,options.retries??1);
  const delayMs=Math.max(0,options.delayMs??300);
  let lastError:unknown;
  for(let attempt=0;attempt<=retries;attempt++){
    try{return await fetchWithTimeout(input,init,timeoutMs)}
    catch(error){
      lastError=error;
      if(attempt>=retries)break;
      await new Promise(resolve=>globalThis.setTimeout(resolve,delayMs));
    }
  }
  throw lastError instanceof Error?lastError:new Error("network_unavailable");
}
