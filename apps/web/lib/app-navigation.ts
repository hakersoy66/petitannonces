import { nativeShellMode } from "./native-shell";

type RouterLike={
  push:(href:string)=>void;
  replace:(href:string)=>void;
};

export function appShellNavigationMode(){
  if(typeof window==="undefined")return false;
  try{
    return nativeShellMode()
      ||window.matchMedia("(display-mode: standalone)").matches
      ||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
  }catch{return false}
}

export function navigateApp(router:RouterLike,href:string,options:{replace?:boolean}={}){
  if(typeof window!=="undefined"&&appShellNavigationMode()){
    if(options.replace)window.location.replace(href);
    else window.location.assign(href);
    return;
  }
  if(options.replace)router.replace(href);
  else router.push(href);
}
