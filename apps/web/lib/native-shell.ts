"use client";

type NativeWindow=Window&{
  __PA_NATIVE_SHELL__?:boolean;
  ReactNativeWebView?:{postMessage:(message:string)=>void};
};

export type NativePushResult={ok:boolean;permission?:string;authenticated?:boolean;enabled?:boolean;error?:string|null};

export function nativeShellMode(){
  if(typeof window==="undefined")return false;
  const w=window as NativeWindow;
  try{return Boolean(w.__PA_NATIVE_SHELL__)||/PetitAnnoncesNative/i.test(navigator.userAgent)||localStorage.getItem("pa_native_shell")==="1";}
  catch{return Boolean(w.__PA_NATIVE_SHELL__)||/PetitAnnoncesNative/i.test(navigator.userAgent)}
}

function requestNativeBridge(type:string,eventName:string,timeoutMs=20000):Promise<NativePushResult>{
  return new Promise(resolve=>{
    if(!nativeShellMode()){resolve({ok:false,permission:"unsupported",error:"not_native_shell"});return}
    const w=window as NativeWindow;
    let done=false;
    const finish=(result:NativePushResult)=>{if(done)return;done=true;window.clearTimeout(timer);window.removeEventListener(eventName,onResult as EventListener);resolve(result)};
    const onResult=(event:Event)=>finish(((event as CustomEvent<NativePushResult>).detail??{ok:false}) as NativePushResult);
    const timer=window.setTimeout(()=>finish({ok:false,permission:"timeout",error:"native_bridge_timeout"}),timeoutMs);
    window.addEventListener(eventName,onResult as EventListener);
    try{w.ReactNativeWebView?.postMessage(JSON.stringify({type}));}
    catch{finish({ok:false,permission:"error",error:"native_bridge_unavailable"})}
  });
}

export function requestNativePush(timeoutMs=20000){return requestNativeBridge("PA_NATIVE_REQUEST_PUSH","pa:native-push-result",timeoutMs)}
export function disableNativePush(timeoutMs=20000){return requestNativeBridge("PA_NATIVE_DISABLE_PUSH","pa:native-push-disable-result",timeoutMs)}
export function inspectNativePush(timeoutMs=10000){return requestNativeBridge("PA_NATIVE_PUSH_STATUS","pa:native-push-status-result",timeoutMs)}
