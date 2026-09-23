import {useEffect,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {PA} from '../constants/theme';
import {apiRequest} from '../lib/api';
import {useAuth} from '../lib/auth';
import {AppIcon} from '../components/app-icon';

export default function Profile(){
 const{token,refresh}=useAuth();
 const[f,setF]=useState({displayName:'',firstName:'',lastName:'',phone:''});
 const[msg,setMsg]=useState('');const[busy,setBusy]=useState(false);
 useEffect(()=>{if(!token)return;apiRequest<any>('/account/settings',{token}).then(r=>{const p=r.user?.profile??{};setF({displayName:p.displayName??'',firstName:p.firstName??'',lastName:p.lastName??'',phone:p.phone??''})}).catch(()=>setMsg('Impossible de charger le profil.'))},[token]);
 async function save(){if(!token)return;setBusy(true);setMsg('');try{await apiRequest('/account/profile',{method:'PATCH',token,body:{displayName:f.displayName||null,firstName:f.firstName||null,lastName:f.lastName||null,phone:f.phone||null,locale:'fr-FR'}});await refresh();setMsg('Profil mis à jour.')}catch{setMsg('Impossible d’enregistrer le profil.')}finally{setBusy(false)}}
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets><Pressable style={s.backButton} onPress={()=>router.back()}><AppIcon name="chevron-left" size={14} color={PA.ink}/><Text style={s.back}>Retour</Text></Pressable><Text style={s.k}>MON COMPTE</Text><Text style={s.title}>Mon profil</Text><Text style={s.lead}>Les informations utiles pour vos annonces et vos échanges.</Text>{[['Nom affiché','displayName'],['Prénom','firstName'],['Nom','lastName'],['Téléphone','phone']].map(([l,k])=><View key={k}><Text style={s.label}>{l}</Text><TextInput value={(f as any)[k]} onChangeText={v=>setF(x=>({...x,[k]:v}))} keyboardType={k==='phone'?'phone-pad':'default'} style={s.input}/></View>)}{msg?<Text style={s.msg}>{msg}</Text>:null}<Pressable disabled={busy} onPress={()=>void save()} style={[s.btn,busy&&{opacity:.55}]}><Text style={s.btnT}>{busy?'Enregistrement…':'Enregistrer'}</Text></Pressable></ScrollView></SafeAreaView>}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:PA.bg},page:{padding:18,paddingBottom:40},backButton:{alignSelf:'flex-start',minHeight:38,paddingHorizontal:12,borderRadius:12,borderWidth:1,borderColor:PA.line,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',gap:7,marginBottom:18},back:{color:PA.ink,fontWeight:'800',fontSize:11},k:{fontSize:11,fontWeight:'900',letterSpacing:1.2,color:PA.primary},title:{fontSize:30,fontWeight:'900',color:PA.ink,marginTop:5},lead:{fontSize:13,lineHeight:19,color:PA.muted,marginTop:6,marginBottom:18},label:{fontSize:12,fontWeight:'900',color:PA.ink,marginTop:10,marginBottom:6},input:{height:50,borderWidth:1,borderColor:PA.line,borderRadius:14,paddingHorizontal:14,backgroundColor:'#fff',fontSize:16},msg:{marginTop:12,color:PA.muted},btn:{height:52,borderRadius:14,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center',marginTop:18},btnT:{color:'#fff',fontWeight:'900'}});

