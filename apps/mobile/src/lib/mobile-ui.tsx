import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet } from './api';

export type MobileUiBlockId='search'|'categories'|'latest'|'map'|'discover'|'pro_banner'|'more'|'vacation';
export type MobileUiAudience='ALL'|'GUEST'|'AUTH'|'PRO';
export type MobileUiBlock={id:MobileUiBlockId;enabled:boolean;order:number;title:string;subtitle:string;itemLimit:number;variant:'DEFAULT'|'COMPACT'|'WIDE';audience:MobileUiAudience};
export type MobileUiNavId='home'|'search'|'sell'|'messages'|'account';
export type MobileUiNavItem={id:MobileUiNavId;label:string;enabled:boolean;order:number};
export type MobileUiPlatformConfig={
 header:{enabled:boolean;showLogo:boolean;showPostButton:boolean;showNotifications:boolean;showAccount:boolean};
 blocks:MobileUiBlock[];
 bottomNav:{enabled:boolean;items:MobileUiNavItem[]};
 theme:{primary:string;background:string;cardRadius:number;density:'COMPACT'|'COMFORTABLE'};
 abTest:{enabled:boolean;percentB:number;variantBOrder:MobileUiBlockId[]};
};
type RemotePayload={schemaVersion:1;revision:number;source:'published'|'scheduled';publishAt:string|null;platform:string;config:MobileUiPlatformConfig};
type Value={config:MobileUiPlatformConfig;revision:number;source:'default'|'cache'|'published'|'scheduled';bucket:number;refresh():Promise<void>};

const defaultBlocks:MobileUiBlock[]=[
 {id:'search',enabled:true,order:10,title:'Rechercher',subtitle:'',itemLimit:1,variant:'DEFAULT',audience:'ALL'},
 {id:'categories',enabled:true,order:20,title:'Catégories',subtitle:'',itemLimit:10,variant:'DEFAULT',audience:'ALL'},
 {id:'latest',enabled:true,order:30,title:'Dernières annonces',subtitle:'',itemLimit:6,variant:'DEFAULT',audience:'ALL'},
 {id:'map',enabled:true,order:40,title:'Explorez les annonces par ville',subtitle:'Touchez une ville pour découvrir les annonces locales.',itemLimit:10,variant:'DEFAULT',audience:'ALL'},
 {id:'discover',enabled:true,order:50,title:'À découvrir',subtitle:'',itemLimit:4,variant:'DEFAULT',audience:'ALL'},
 {id:'pro_banner',enabled:true,order:60,title:'Vous êtes professionnel ?',subtitle:'Ouvrez votre boutique gratuitement',itemLimit:1,variant:'DEFAULT',audience:'ALL'},
 {id:'more',enabled:true,order:70,title:'Plus d’annonces',subtitle:'',itemLimit:6,variant:'DEFAULT',audience:'ALL'},
 {id:'vacation',enabled:true,order:80,title:'Vacances Petit Annonces',subtitle:'Partez moins cher, profitez plus.',itemLimit:4,variant:'DEFAULT',audience:'ALL'},
];
const defaultNav:MobileUiNavItem[]=[
 {id:'home',label:'Accueil',enabled:true,order:10},{id:'search',label:'Rechercher',enabled:true,order:20},{id:'sell',label:'Déposer',enabled:true,order:30},{id:'messages',label:'Messages',enabled:true,order:40},{id:'account',label:'Compte',enabled:true,order:50},
];
export const DEFAULT_MOBILE_UI:MobileUiPlatformConfig={header:{enabled:true,showLogo:true,showPostButton:true,showNotifications:true,showAccount:true},blocks:defaultBlocks,bottomNav:{enabled:true,items:defaultNav},theme:{primary:'#5b4cf0',background:'#f7f7fb',cardRadius:18,density:'COMFORTABLE'},abTest:{enabled:false,percentB:50,variantBOrder:[]}};

const Ctx=createContext<Value|null>(null);
const CACHE='pa:mobile-ui:v1';
const BUCKET='pa:mobile-ui:bucket:v1';
function nativePlatform(){return Platform.OS==='ios'?'IOS':'ANDROID'}
function validConfig(value:unknown):value is MobileUiPlatformConfig{
 if(!value||typeof value!=='object')return false;
 const v=value as Partial<MobileUiPlatformConfig>;
 return Array.isArray(v.blocks)&&Boolean(v.header)&&Boolean(v.bottomNav)&&Boolean(v.theme)&&Boolean(v.abTest);
}

export function MobileUiProvider({children}:{children:ReactNode}){
 const[config,setConfig]=useState<MobileUiPlatformConfig>(DEFAULT_MOBILE_UI);const[revision,setRevision]=useState(0);const[source,setSource]=useState<Value['source']>('default');const[bucket,setBucket]=useState(0);
 useEffect(()=>{let active=true;(async()=>{const storedBucket=await AsyncStorage.getItem(BUCKET);let next=Number(storedBucket);if(!Number.isFinite(next)||next<0||next>99){next=Math.floor(Math.random()*100);await AsyncStorage.setItem(BUCKET,String(next))}if(active)setBucket(next);const cached=await AsyncStorage.getItem(`${CACHE}:${nativePlatform()}`);if(!cached)return;try{const p=JSON.parse(cached) as RemotePayload;if(active&&validConfig(p.config)){setConfig(p.config);setRevision(Number(p.revision)||0);setSource('cache')}}catch{}})();return()=>{active=false}},[]);
 const refresh=useCallback(async()=>{try{const p=await apiGet<RemotePayload>(`/mobile/ui-config?platform=${nativePlatform()}`);if(!validConfig(p.config))return;setConfig(p.config);setRevision(Number(p.revision)||0);setSource(p.source);await AsyncStorage.setItem(`${CACHE}:${nativePlatform()}`,JSON.stringify(p))}catch{}},[]);
 useEffect(()=>{void refresh();const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh()});return()=>sub.remove()},[refresh]);
 const effective=useMemo(()=>{
   if(!config.abTest.enabled||bucket>=config.abTest.percentB||config.abTest.variantBOrder.length===0)return config;
   const rank=new Map(config.abTest.variantBOrder.map((id,index)=>[id,index]));
   const blocks=[...config.blocks].sort((a,b)=>(rank.get(a.id)??1000+a.order)-(rank.get(b.id)??1000+b.order)).map((b,index)=>({...b,order:(index+1)*10}));
   return {...config,blocks};
 },[config,bucket]);
 const value=useMemo<Value>(()=>({config:effective,revision,source,bucket,refresh}),[effective,revision,source,bucket,refresh]);
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useMobileUi(){const value=useContext(Ctx);if(!value)throw new Error('MobileUiProvider missing');return value}
