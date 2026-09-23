import {useEffect,useState} from 'react';
import {Linking,Pressable,ScrollView,StyleSheet,Switch,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {PA} from '../constants/theme';
import {apiRequest} from '../lib/api';
import {useAuth} from '../lib/auth';
import {usePush} from '../lib/push';
import {AppIcon} from '../components/app-icon';

const defs=[['inAppMessages','Messages dans l’application'],['inAppOffers','Offres dans l’application'],['inAppListingUpdates','Suivi des annonces'],['emailMessages','Messages par e-mail'],['emailOffers','Offres par e-mail'],['emailListingUpdates','Annonces par e-mail'],['emailMarketing','Actualités & marketing'],['pushMessages','Messages push'],['pushOffers','Offres push'],['pushListingUpdates','Annonces push']] as const;

export default function NotificationSettings(){
  const{token}=useAuth();
  const{permission,subscribed,busy:pushBusy,projectReady,error:pushError,enablePush,badgeCount}=usePush();
  const[p,setP]=useState<any>(null);const[msg,setMsg]=useState('');
  useEffect(()=>{if(token)apiRequest<any>('/account/settings',{token}).then(r=>setP(r.preferences)).catch(()=>setMsg('Chargement impossible.'))},[token]);
  async function toggle(k:string,v:boolean){
    if(!p||!token)return;
    const previous=p;const next={...p,[k]:v};setP(next);setMsg('');
    try{
      const body:any={};for(const[d]of defs)body[d]=Boolean(next[d]);
      await apiRequest('/account/notification-preferences',{method:'PUT',token,body});
      if(k.startsWith('push')&&v&&permission!=='granted'){
        const ok=await enablePush();
        setMsg(ok?'Préférence enregistrée et notifications Android activées.':'Préférence enregistrée. Autorisez aussi les notifications dans Android.');
      }else setMsg('Préférences enregistrées.');
    }catch{setP(previous);setMsg('Enregistrement impossible.');}
  }
  async function repairPush(){
    setMsg('');
    const ok=await enablePush();
    setMsg(ok?'Test envoyé. Une notification « Notifications activées » doit apparaître sur cet appareil.':'Activation impossible. Vérifiez les autorisations Android puis réessayez.');
  }
  const pushTitle=permission==='denied'?'Autorisation Android refusée':permission==='granted'&&subscribed?'Push Android actif':permission==='granted'?'Autorisé · abonnement à réparer':'Notifications Android à activer';
  const pushText=!projectReady?'Configuration EAS incomplète.':permission==='denied'?'Petit Annonces ne peut pas afficher de notification tant que l’autorisation système reste désactivée.':subscribed?`Cet appareil est enregistré pour les notifications. Badge actuel : ${badgeCount}.`:'Activez puis envoyez un test pour enregistrer cet appareil auprès de Petit Annonces.';
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <Pressable style={s.backButton} onPress={()=>router.back()}><AppIcon name="chevron-left" size={14} color={PA.ink}/><Text style={s.back}>Retour</Text></Pressable>
    <Text style={s.k}>NOTIFICATIONS</Text><Text style={s.title}>Mes préférences</Text><Text style={s.lead}>Choisissez ce que Petit Annonces peut vous envoyer.</Text>
    <View style={[s.pushCard,subscribed&&permission==='granted'&&s.pushCardOk]}>
      <View style={s.pushHead}><View style={[s.pushIcon,subscribed&&permission==='granted'&&s.pushIconOk]}><AppIcon name="bell" size={18} color={subscribed&&permission==='granted'?'#168963':PA.primary}/></View><View style={{flex:1}}><Text style={s.pushTitle}>{pushTitle}</Text><Text style={s.pushText}>{pushText}</Text></View></View>
      {pushError&&pushError!=='permission_denied'?<Text style={s.pushHint}>La dernière tentative n’a pas pu être finalisée. Le bouton ci-dessous relance toute la chaîne permission → FCM → abonnement → test.</Text>:null}
      {permission==='denied'?<Pressable style={s.pushButton} onPress={()=>void Linking.openSettings()}><AppIcon name="gears" size={14} color="#fff"/><Text style={s.pushButtonText}>Ouvrir les réglages Android</Text></Pressable>:<Pressable disabled={pushBusy||!projectReady} style={[s.pushButton,(pushBusy||!projectReady)&&s.disabled]} onPress={()=>void repairPush()}><AppIcon name="paper-plane" size={14} color="#fff"/><Text style={s.pushButtonText}>{pushBusy?'Activation…':'Activer et envoyer un test'}</Text></Pressable>}
    </View>
    <View style={s.card}>{defs.map(([k,l])=><View key={k} style={s.row}><Text style={s.label}>{l}</Text><Switch value={Boolean(p?.[k])} onValueChange={v=>void toggle(k,v)} trackColor={{true:'#b9b2ff'}} thumbColor={Boolean(p?.[k])?PA.primary:'#f4f4f5'}/></View>)}</View>
    {msg?<Text style={s.msg}>{msg}</Text>:null}
  </ScrollView></SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:PA.bg},page:{padding:18,paddingBottom:48},backButton:{alignSelf:'flex-start',minHeight:38,paddingHorizontal:12,borderRadius:12,borderWidth:1,borderColor:PA.line,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',gap:7,marginBottom:18},back:{color:PA.ink,fontWeight:'800',fontSize:11},k:{fontSize:11,fontWeight:'900',letterSpacing:1.2,color:PA.primary},title:{fontSize:30,fontWeight:'900',color:PA.ink,marginTop:5},lead:{fontSize:13,lineHeight:19,color:PA.muted,marginTop:6,marginBottom:14},
 pushCard:{padding:15,borderRadius:20,borderWidth:1,borderColor:'#e2ddff',backgroundColor:'#f8f6ff',marginBottom:14},pushCardOk:{borderColor:'#cfe9dc',backgroundColor:'#f1faf5'},pushHead:{flexDirection:'row',gap:11,alignItems:'flex-start'},pushIcon:{width:42,height:42,borderRadius:13,backgroundColor:'#ece9ff',alignItems:'center',justifyContent:'center'},pushIconOk:{backgroundColor:'#ddf4e8'},pushTitle:{fontSize:14,fontWeight:'900',color:PA.ink},pushText:{fontSize:11,lineHeight:16,color:PA.muted,marginTop:4},pushHint:{fontSize:10.5,lineHeight:15,color:'#8a6413',marginTop:10},pushButton:{minHeight:45,borderRadius:13,backgroundColor:PA.primary,marginTop:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},pushButtonText:{color:'#fff',fontSize:12,fontWeight:'900'},disabled:{opacity:.45},
 card:{backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,borderRadius:20,overflow:'hidden'},row:{minHeight:58,paddingHorizontal:15,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:'#f0f0f4',gap:12},label:{flex:1,fontWeight:'700',color:PA.ink,fontSize:13},msg:{marginTop:12,color:PA.muted,fontSize:11,lineHeight:16}
});
