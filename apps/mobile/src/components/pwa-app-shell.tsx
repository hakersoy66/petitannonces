import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ORIGIN='https://petitannonces.fr';
const NATIVE_PUSH_DISABLED_KEY='pa.native.push.disabled.v1';

function safePath(raw:string){
  try{
    const decoded=decodeURIComponent(raw||'/');
    if(!decoded.startsWith('/')||decoded.startsWith('//'))return '/';
    return decoded;
  }catch{return '/'}
}

function nativePlatform(){return Platform.OS==='ios'?'IOS':'ANDROID'}

function deviceLabel(){
  const name=Device.deviceName?.trim()||Device.modelName?.trim()||'Appareil';
  return `${Platform.OS==='ios'?'iOS':'Android'} · ${name}`.slice(0,120);
}

async function expoPushToken(requestPermission:boolean){
  if(Platform.OS==='android'){
    await Notifications.setNotificationChannelAsync('pa-general-v3',{
      name:'Petit Annonces',
      importance:Notifications.AndroidImportance.HIGH,
      sound:'default',
      showBadge:true,
    });
  }
  let permission=await Notifications.getPermissionsAsync();
  if(requestPermission&&permission.status!=='granted'){
    permission=Platform.OS==='ios'
      ? await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:true,allowSound:true}})
      : await Notifications.requestPermissionsAsync();
  }
  if(permission.status!=='granted')return {token:null,permission:permission.status};
  const projectId=Constants.expoConfig?.extra?.eas?.projectId;
  if(!projectId)return {token:null,permission:'granted',error:'project_id_missing'};
  const devicePushToken=await Notifications.getDevicePushTokenAsync();
  const token=(await Notifications.getExpoPushTokenAsync({projectId:String(projectId),devicePushToken})).data.trim();
  return {token:token||null,permission:'granted'};
}

type NativeInsets={top:number;right:number;bottom:number;left:number};
const NATIVE_UI_REVISION='2026-09-26-android-scroll-safearea-v2';

function buildBootstrapScript(insets:NativeInsets){
  const platformClass=Platform.OS==='ios'?'pa-native-ios':'pa-native-android';
  const platformName=Platform.OS==='ios'?'IOS':'ANDROID';
  const top=Math.max(0,Math.round(insets.top));
  const right=Math.max(0,Math.round(insets.right));
  const bottom=Math.max(0,Math.round(insets.bottom));
  const left=Math.max(0,Math.round(insets.left));
  return `
(function(){
  try{
    window.__PA_NATIVE_SHELL__=true;
    window.__PA_NATIVE_PLATFORM__='${platformName}';
    window.__PA_NATIVE_UI_REVISION__='${NATIVE_UI_REVISION}';
    var root=document.documentElement;
    if(root){
      root.classList.add('pa-native-shell','${platformClass}');
      root.style.setProperty('--pa-native-safe-top','${top}px');
      root.style.setProperty('--pa-native-safe-right','${right}px');
      root.style.setProperty('--pa-native-safe-bottom','${bottom}px');
      root.style.setProperty('--pa-native-safe-left','${left}px');
    }
    localStorage.setItem('pa_pwa_installed','1');
    localStorage.setItem('pa_native_shell','1');
    localStorage.setItem('pa_native_ui_revision','${NATIVE_UI_REVISION}');
    document.cookie='pa_pwa_installed=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure';
    var applyNativeUi=function(){
      var html=document.documentElement;
      if(html){
        html.classList.add('pa-native-shell','${platformClass}');
        html.style.setProperty('--pa-native-safe-top','${top}px');
        html.style.setProperty('--pa-native-safe-right','${right}px');
        html.style.setProperty('--pa-native-safe-bottom','${bottom}px');
        html.style.setProperty('--pa-native-safe-left','${left}px');
      }
      window.dispatchEvent(new CustomEvent('pa:native-ui-sync',{detail:{platform:'${platformName}',revision:'${NATIVE_UI_REVISION}',safeArea:{top:${top},right:${right},bottom:${bottom},left:${left}}}}));
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyNativeUi,{once:true});
    else applyNativeUi();
    var sendAuth=function(){
      fetch('/api/auth/me',{credentials:'include',cache:'no-store'})
        .then(function(r){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'PA_NATIVE_AUTH',authenticated:r.ok}));})
        .catch(function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'PA_NATIVE_AUTH',authenticated:false}));});
    };
    window.addEventListener('pa:native-auth-sync',sendAuth);
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'){applyNativeUi();sendAuth();}});
    window.addEventListener('focus',function(){applyNativeUi();sendAuth();});
    setTimeout(function(){applyNativeUi();sendAuth();},350);
  }catch(e){}
})();true;`;
}

export function PwaAppShell({initialPath='/'}:{initialPath?:string}){
  const web=useRef<WebView>(null);
  const insets=useSafeAreaInsets();
  const [canGoBack,setCanGoBack]=useState(false);
  const path=safePath(initialPath);
  const url=useMemo(()=>ORIGIN+path,[path]);
  const bootstrap=useMemo(()=>buildBootstrapScript(insets),[insets]);

  const notifyWeb=useCallback((eventName:string,detail:Record<string,unknown>)=>{
    const payload=JSON.stringify(detail).replace(/</g,'\\u003c');
    web.current?.injectJavaScript(`window.dispatchEvent(new CustomEvent('${eventName}',{detail:${payload}}));true;`);
  },[]);
  const notifyPushResult=useCallback((detail:Record<string,unknown>)=>notifyWeb('pa:native-push-result',detail),[notifyWeb]);

  const subscribeInWebSession=useCallback((nativeToken:string)=>{
    const body=JSON.stringify({platform:nativePlatform(),nativeToken,deviceLabel:deviceLabel()});
    const encoded=JSON.stringify(body);
    web.current?.injectJavaScript(`
      fetch('/api/notifications/push/subscribe',{
        method:'POST',credentials:'include',
        headers:{'content-type':'application/json'},
        body:${encoded}
      }).then(function(r){
        window.dispatchEvent(new CustomEvent('pa:native-push-result',{detail:{ok:r.ok,permission:'granted',authenticated:r.status!==401}}));
        window.dispatchEvent(new CustomEvent('pa:notification-native-synced',{detail:{ok:r.ok}}));
      }).catch(function(){
        window.dispatchEvent(new CustomEvent('pa:native-push-result',{detail:{ok:false,permission:'granted'}}));
      });true;`);
  },[]);

  const unsubscribeInWebSession=useCallback((nativeToken:string)=>{
    const body=JSON.stringify({nativeToken});
    const encoded=JSON.stringify(body);
    web.current?.injectJavaScript(`fetch('/api/notifications/push/unsubscribe',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:${encoded}}).then(function(r){window.dispatchEvent(new CustomEvent('pa:native-push-disable-result',{detail:{ok:r.ok}}));}).catch(function(){window.dispatchEvent(new CustomEvent('pa:native-push-disable-result',{detail:{ok:false}}));});true;`);
  },[]);

  const syncNativePush=useCallback(async(requestPermission:boolean)=>{
    try{
      const result=await expoPushToken(requestPermission);
      if(result.permission!=='granted'||!result.token){
        notifyPushResult({ok:false,permission:result.permission,error:result.error??null});
        return false;
      }
      subscribeInWebSession(result.token);
      return true;
    }catch(error){
      notifyPushResult({ok:false,permission:'error',error:error instanceof Error?error.message:'push_failed'});
      return false;
    }
  },[notifyPushResult,subscribeInWebSession]);

  const onMessage=useCallback((event:any)=>{
    try{
      const data=JSON.parse(String(event.nativeEvent.data||'{}')) as {type?:string;authenticated?:boolean};
      void (async()=>{
        if(data.type==='PA_NATIVE_REQUEST_PUSH'){
          await AsyncStorage.removeItem(NATIVE_PUSH_DISABLED_KEY);
          await syncNativePush(true);
          return;
        }
        if(data.type==='PA_NATIVE_DISABLE_PUSH'){
          await AsyncStorage.setItem(NATIVE_PUSH_DISABLED_KEY,'1');
          const result=await expoPushToken(false);
          if(result.token)unsubscribeInWebSession(result.token);
          else notifyWeb('pa:native-push-disable-result',{ok:true});
          return;
        }
        if(data.type==='PA_NATIVE_PUSH_STATUS'){
          const [permission,disabled]=await Promise.all([Notifications.getPermissionsAsync(),AsyncStorage.getItem(NATIVE_PUSH_DISABLED_KEY)]);
          notifyWeb('pa:native-push-status-result',{ok:true,permission:permission.status,enabled:permission.status==='granted'&&disabled!=='1'});
          return;
        }
        if(data.type==='PA_NATIVE_AUTH'&&data.authenticated){
          const disabled=await AsyncStorage.getItem(NATIVE_PUSH_DISABLED_KEY);
          if(disabled==='1')return;
          const permission=await Notifications.getPermissionsAsync();
          if(permission.status==='granted')await syncNativePush(false);
        }
      })();
    }catch{}
  },[notifyWeb,syncNativePush,unsubscribeInWebSession]);

  useEffect(()=>{
    const sub=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(canGoBack){web.current?.goBack();return true}
      return false;
    });
    return()=>sub.remove();
  },[canGoBack]);

  function allowNavigation(request:{url:string}){
    if(request.url==='about:blank')return true;
    try{
      const target=new URL(request.url);
      if(['petitannonces.fr','www.petitannonces.fr'].includes(target.hostname))return true;
      if(['http:','https:','mailto:','tel:'].includes(target.protocol)){void Linking.openURL(request.url);return false}
      return false;
    }catch{return false}
  }

  return <View style={[s.root,Platform.OS==='android'&&insets.top>0?{paddingTop:insets.top}:null]}>
    <WebView
      ref={web}
      source={{uri:url}}
      style={s.web}
      originWhitelist={['https://*','http://*']}
      applicationNameForUserAgent="PetitAnnoncesNative/1.0"
      injectedJavaScriptBeforeContentLoaded={bootstrap}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled
      nestedScrollEnabled
      overScrollMode="always"
      showsVerticalScrollIndicator={false}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={allowNavigation}
      onNavigationStateChange={state=>setCanGoBack(Boolean(state.canGoBack))}
      onLoadEnd={()=>web.current?.injectJavaScript(bootstrap)}
    />
  </View>;
}

const s=StyleSheet.create({root:{flex:1,backgroundColor:'#fff'},web:{flex:1,backgroundColor:'#fff'}});
