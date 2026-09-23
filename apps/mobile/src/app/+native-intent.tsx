function shell(path:string){return `/web-feature?path=${encodeURIComponent(path||'/')}`}

export function redirectSystemPath({path}:{path:string;initial:boolean}){
  try{
    if(!path)return shell('/');
    const url=new URL(path,'https://petitannonces.fr');
    if(url.protocol==='http:'||url.protocol==='https:'){
      if(!['petitannonces.fr','www.petitannonces.fr'].includes(url.hostname))return shell('/');
      return shell(`${url.pathname||'/'}${url.search}${url.hash}`);
    }
    if(url.protocol==='petitannonces:'){
      const pathname='/'+[url.hostname,url.pathname.replace(/^\/+/, '')].filter(Boolean).join('/');
      return shell(`${pathname.replace(/\/{2,}/g,'/')||'/'}${url.search}${url.hash}`);
    }
    return shell('/');
  }catch{return shell('/')}
}