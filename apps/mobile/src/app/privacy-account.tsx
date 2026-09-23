import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { PA } from '../constants/theme';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AppIcon } from '../components/app-icon';

type PrivacyRequest={id:string;type:'ACCESS'|'EXPORT'|'RECTIFICATION'|'ERASURE'|'RESTRICTION'|'OBJECTION';status:string;requestReference:string;requestedAt:string;responseDueAt:string;completedAt:string|null};
const label:Record<PrivacyRequest['type'],string>={ACCESS:'Accès aux données',EXPORT:'Export des données',RECTIFICATION:'Rectification',ERASURE:'Suppression du compte',RESTRICTION:'Limitation',OBJECTION:'Opposition'};
const WEB='https://petitannonces.fr';

export default function PrivacyAccountScreen(){
  const {token,user,logout}=useAuth();
  const [items,setItems]=useState<PrivacyRequest[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState<'EXPORT'|'ERASURE'|null>(null),[message,setMessage]=useState('');
  const load=useCallback(async()=>{if(!token)return;setLoading(true);try{const p=await apiRequest<{requests:PrivacyRequest[]}>('/privacy/requests',{token});setItems(p.requests??[])}catch(e){if(e instanceof ApiError&&e.status===401)router.replace('/auth/login');else setMessage('Impossible de charger vos demandes de confidentialité.')}finally{setLoading(false)}},[token]);
  useEffect(()=>{void load()},[load]);
  async function create(type:'EXPORT'|'ERASURE'){
    if(!token)return;
    setBusy(type);setMessage('');
    try{const p=await apiRequest<{request:{reference:string}}>('/privacy/requests',{method:'POST',token,body:{type}});setMessage(type==='ERASURE'?`Demande de suppression enregistrée · ${p.request.reference}`:`Demande d’export enregistrée · ${p.request.reference}`);await load();if(type==='ERASURE')Alert.alert('Demande enregistrée','Votre demande de suppression du compte a été transmise. Petit Annonces la traite conformément aux obligations légales et vous contactera si une vérification est nécessaire.');}
    catch(e){setMessage(e instanceof ApiError&&e.status===401?'Votre session a expiré.':'La demande n’a pas pu être enregistrée. Réessayez.')}
    finally{setBusy(null)}
  }
  function askDelete(){
    const already=items.some(x=>x.type==='ERASURE'&&!['COMPLETED','REJECTED','CANCELED'].includes(x.status));
    if(already){Alert.alert('Demande déjà en cours','Une demande de suppression du compte est déjà ouverte.');return}
    Alert.alert('Supprimer mon compte ?','Cette demande concerne la suppression de votre compte et des données pouvant légalement être effacées. Certaines données liées aux obligations comptables, fiscales, fraude, litiges ou transactions peuvent devoir être conservées pendant la durée légale.',[
      {text:'Annuler',style:'cancel'},
      {text:'Continuer',style:'destructive',onPress:()=>Alert.alert('Confirmation finale','Voulez-vous vraiment envoyer la demande de suppression de votre compte Petit Annonces ?', [{text:'Annuler',style:'cancel'},{text:'Envoyer la demande',style:'destructive',onPress:()=>void create('ERASURE')}])}
    ]);
  }
  async function open(path:string){await Linking.openURL(`${WEB}${path}`)}
  if(!user)return <SafeAreaView style={s.safe}><View style={s.center}><Text style={s.title}>Confidentialité & compte</Text><Text style={s.muted}>Connectez-vous pour gérer vos données.</Text><Pressable style={s.primary} onPress={()=>router.replace('/auth/login')}><Text style={s.primaryText}>Se connecter</Text></Pressable></View></SafeAreaView>;
  return <SafeAreaView style={s.safe} edges={['top']}><ScrollView contentContainerStyle={s.page}>
    <View style={s.head}><Pressable accessibilityRole="button" accessibilityLabel="Retour" style={s.back} onPress={()=>router.back()}><AppIcon name="chevron-left" size={15} color={PA.ink}/></Pressable><View style={{flex:1}}><Text style={s.eyebrow}>MON COMPTE</Text><Text style={s.title}>Confidentialité & compte</Text></View></View>
    <Text style={s.lead}>Gérez vos données personnelles, vos demandes RGPD et les documents juridiques Petit Annonces.</Text>
    {message?<View style={s.notice}><Text style={s.noticeText}>{message}</Text></View>:null}
    <View style={s.card}><Text style={s.cardTitle}>Vos données</Text><Text style={s.cardText}>Vous pouvez demander une copie structurée des données associées à votre compte.</Text><Pressable disabled={busy!==null} style={s.action} onPress={()=>void create('EXPORT')}><Text style={s.actionText}>{busy==='EXPORT'?'Enregistrement…':'Demander l’export de mes données'}</Text></Pressable></View>
    <View style={s.card}><Text style={s.cardTitle}>Documents & assistance</Text><LegalRow text="Politique de confidentialité" onPress={()=>void open('/confidentialite')}/><LegalRow text="Conditions générales" onPress={()=>void open('/conditions-generales')}/><LegalRow text="Mentions légales" onPress={()=>void open('/mentions-legales')}/><LegalRow text="Centre d’aide & support" onPress={()=>void open('/assistance')}/><LegalRow text="Suppression du compte sur le web" onPress={()=>void open('/supprimer-mon-compte')}/></View>
    <View style={s.card}><View style={s.rowHead}><Text style={s.cardTitle}>Mes demandes</Text>{loading?<ActivityIndicator size="small" color={PA.primary}/>:null}</View>{!loading&&!items.length?<Text style={s.cardText}>Aucune demande de confidentialité en cours.</Text>:items.slice(0,8).map(x=><View key={x.id} style={s.request}><View style={{flex:1}}><Text style={s.requestTitle}>{label[x.type]??x.type}</Text><Text style={s.requestRef}>{x.requestReference}</Text></View><Text style={s.requestStatus}>{x.status}</Text></View>)}</View>
    <View style={[s.card,s.dangerCard]}><Text style={s.dangerTitle}>Supprimer mon compte</Text><Text style={s.cardText}>Vous pouvez initier la suppression de votre compte directement depuis l’application. La demande couvre les données pouvant être effacées ; les éléments soumis à une obligation légale de conservation sont traités conformément à la réglementation.</Text><Pressable disabled={busy!==null} style={s.dangerButton} onPress={askDelete}><Text style={s.dangerButtonText}>{busy==='ERASURE'?'Enregistrement…':'Demander la suppression du compte'}</Text></Pressable></View>
    <Pressable style={s.logout} onPress={()=>void logout()}><Text style={s.logoutText}>Se déconnecter</Text></Pressable>
  </ScrollView></SafeAreaView>
}
function LegalRow({text,onPress}:{text:string;onPress:()=>void}){return <Pressable style={s.legalRow} onPress={onPress}><Text style={s.legalText}>{text}</Text><AppIcon name="chevron-right" size={14} color={PA.muted}/></Pressable>}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:PA.bg},page:{padding:18,paddingBottom:44},center:{flex:1,padding:24,justifyContent:'center'},head:{flexDirection:'row',alignItems:'center',gap:12},back:{width:40,height:40,borderRadius:13,borderWidth:1,borderColor:PA.line,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},backText:{fontSize:27,lineHeight:29,color:PA.ink},eyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.2,color:PA.primary},title:{fontSize:25,fontWeight:'900',letterSpacing:-.6,color:PA.ink,marginTop:3},lead:{fontSize:12.5,lineHeight:19,color:PA.muted,marginTop:12,marginBottom:14},muted:{color:PA.muted,marginVertical:10},notice:{padding:12,borderRadius:14,backgroundColor:'#efedff',marginBottom:12},noticeText:{fontSize:11.5,lineHeight:17,color:'#5146c7',fontWeight:'700'},card:{padding:16,borderRadius:20,backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,marginBottom:12},cardTitle:{fontSize:15,fontWeight:'900',color:PA.ink},cardText:{fontSize:11.5,lineHeight:18,color:PA.muted,marginTop:6},action:{minHeight:46,borderRadius:13,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center',marginTop:13},actionText:{fontSize:12,fontWeight:'900',color:'#fff'},legalRow:{minHeight:48,flexDirection:'row',alignItems:'center',borderTopWidth:1,borderTopColor:'#f0f0f4',marginTop:9,paddingTop:8},legalText:{flex:1,fontSize:13,fontWeight:'700',color:PA.ink},chev:{fontSize:24,color:PA.muted},rowHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},request:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderTopWidth:1,borderTopColor:'#f0f0f4'},requestTitle:{fontSize:12,fontWeight:'800',color:PA.ink},requestRef:{fontSize:9.5,color:PA.muted,marginTop:2},requestStatus:{fontSize:9,fontWeight:'900',color:PA.primary,backgroundColor:'#efedff',paddingHorizontal:8,paddingVertical:5,borderRadius:999},dangerCard:{borderColor:'#f0d4d4',backgroundColor:'#fffafa'},dangerTitle:{fontSize:15,fontWeight:'900',color:PA.danger},dangerButton:{minHeight:47,borderRadius:13,backgroundColor:'#fff',borderWidth:1,borderColor:'#e6bcbc',alignItems:'center',justifyContent:'center',marginTop:13},dangerButtonText:{fontSize:12,fontWeight:'900',color:PA.danger},logout:{height:48,borderRadius:14,backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,alignItems:'center',justifyContent:'center',marginTop:2},logoutText:{color:PA.muted,fontWeight:'800'},primary:{height:50,borderRadius:14,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center',marginTop:12},primaryText:{color:'#fff',fontWeight:'900'}});