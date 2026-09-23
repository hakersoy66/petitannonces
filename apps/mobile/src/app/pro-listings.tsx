import {useCallback,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Pressable,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Image} from 'expo-image';
import {router,useFocusEffect} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {PA} from '../constants/theme';
import {ApiError,apiRequest} from '../lib/api';
import {useAuth} from '../lib/auth';
import {money} from '../lib/format';
import { AppIcon } from '../components/app-icon';
type Status='DRAFT'|'PENDING'|'PUBLISHED'|'SUSPENDED'|'SOLD'|'EXPIRED';
type Item={id:string;title:string|null;slug:string|null;status:Status;priceMinor:number|null;currency:string;city:string|null;imageUrl:string|null;store?:{id:string;name:string}|null;promotions?:{id:string;name:string;type:string}[];performance?:{views30:number;favorites:number;conversations:number;offers:number}};
type Store={id:string;name:string;status:string};
type Payload={listings:Item[]};type Pro={professional:{stores:Store[]}|null};
const labels:Record<Status,string>={DRAFT:'Brouillon',PENDING:'Modération',PUBLISHED:'En ligne',SUSPENDED:'En pause',SOLD:'Vendue',EXPIRED:'Expirée'};
export default function ProListings(){const{user,token,loading:authLoading}=useAuth();const[items,setItems]=useState<Item[]>([]),[stores,setStores]=useState<Store[]>([]),[selected,setSelected]=useState<string[]>([]),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async(soft=false)=>{if(!token){setLoading(false);return}if(soft)setRefreshing(true);else setLoading(true);setError('');try{const[a,b]=await Promise.all([apiRequest<Payload>('/account/listings',{token}),apiRequest<Pro>('/pro/me',{token})]);setItems(a.listings??[]);setStores((b.professional?.stores??[]).filter(x=>x.status!=='SUSPENDED'));setSelected(s=>s.filter(id=>(a.listings??[]).some(x=>x.id===id)))}catch(e){if(e instanceof ApiError&&e.status===401)router.replace('/auth/login');else setError('Impossible de charger vos annonces professionnelles.')}finally{setLoading(false);setRefreshing(false)}},[token]);
 useFocusEffect(useCallback(()=>{void load();return()=>{}},[load]));const picked=useMemo(()=>items.filter(x=>selected.includes(x.id)),[items,selected]);const published=picked.length>0&&picked.every(x=>x.status==='PUBLISHED');const suspended=picked.length>0&&picked.every(x=>x.status==='SUSPENDED');
 function toggle(id:string){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}function selectAll(){setSelected(selected.length===items.length?[]:items.map(x=>x.id))}
 async function bulk(action:'PAUSE'|'RESUME'|'SOLD'|'ATTACH_STORE'|'DETACH_STORE',storeId?:string){if(!token||busy||!selected.length)return;setBusy(true);setError('');try{await apiRequest('/pro/listings/bulk',{method:'POST',token,body:{listingIds:selected,action,storeId}});setSelected([]);await load(true)}catch(e){const c=e instanceof ApiError?e.code:'';setError(c==='invalid_bulk_transition'?'Les annonces sélectionnées ne sont pas toutes dans un état compatible avec cette action.':c==='store_suspended'?'Cette boutique est suspendue.':'L’action groupée n’a pas pu être appliquée.')}finally{setBusy(false)}}
 function sold(){Alert.alert('Marquer comme vendues',`${selected.length} annonce(s) seront marquées comme vendues.`,[{text:'Annuler',style:'cancel'},{text:'Confirmer',style:'destructive',onPress:()=>void bulk('SOLD')}])}
 if(authLoading||loading)return <SafeAreaView style={s.center}><ActivityIndicator color={PA.primary}/></SafeAreaView>;if(!user||!token)return <SafeAreaView style={s.center}><Text style={s.title}>Gestion Pro</Text><Pressable style={s.primary} onPress={()=>router.replace('/auth/login')}><Text style={s.primaryText}>Se connecter</Text></Pressable></SafeAreaView>;if(user.kind!=='PROFESSIONNEL')return <SafeAreaView style={s.center}><Text style={s.title}>Espace réservé aux professionnels</Text></SafeAreaView>;
 return (
  <SafeAreaView style={s.safe} edges={['top']}>
   <View style={s.head}>
    <Pressable accessibilityRole="button" accessibilityLabel="Retour" style={s.back} onPress={()=>router.back()}><AppIcon name="chevron-left" size={15} color={PA.ink}/></Pressable>
    <View style={{flex:1}}><Text style={s.eyebrow}>ESPACE PRO</Text><Text style={s.title}>Gestion des annonces</Text></View>
    <Pressable onPress={selectAll}><Text style={s.selectAll}>{selected.length===items.length&&items.length?'Tout retirer':'Tout sélectionner'}</Text></Pressable>
   </View>
   {error?<Text style={s.error}>{error}</Text>:null}
   {selected.length?(
    <View style={s.bulk}>
     <Text style={s.bulkTitle}>{selected.length} sélectionnée{selected.length>1?'s':''}</Text>
     <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bulkRow}>
      {published?<Action label="Mettre en pause" onPress={()=>void bulk('PAUSE')}/>:null}
      {suspended?<Action label="Remettre en ligne" onPress={()=>void bulk('RESUME')}/>:null}
      {published?<Action label="Marquer vendue" danger onPress={sold}/>:null}
      <Action label="Retirer de la boutique" onPress={()=>void bulk('DETACH_STORE')}/>
      {stores.map(st=><Action key={st.id} label={`→ ${st.name}`} onPress={()=>void bulk('ATTACH_STORE',st.id)}/>)}
      {published?<Action label="Booster" primary onPress={()=>router.push({pathname:'/pro-promotions',params:{ids:selected.join(',')}} as never)}/>:null}
     </ScrollView>
     <Text style={s.bulkNote}>{suspended?'La remise en ligne renvoie les annonces en modération avant publication.':'Les actions sont appliquées uniquement si toutes les annonces sélectionnées sont compatibles.'}</Text>
    </View>
   ):null}
   <FlatList
    data={items}
    keyExtractor={x=>x.id}
    contentContainerStyle={s.list}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={PA.primary}/>}
    ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTitle}>Aucune annonce</Text></View>}
    renderItem={({item})=>(
     <Pressable style={[s.card,selected.includes(item.id)&&s.cardOn]} onPress={()=>toggle(item.id)}>
      <View style={[s.check,selected.includes(item.id)&&s.checkOn]}><Text style={s.checkText}>{selected.includes(item.id)?'✓':''}</Text></View>
      {item.imageUrl?<Image source={{uri:item.imageUrl}} style={s.image} contentFit="cover"/>:<View style={s.imageEmpty}><Text style={s.imageEmptyText}>PA</Text></View>}
      <View style={s.copy}>
       <View style={s.row}><Text style={s.status}>{labels[item.status]}</Text>{item.store?<Text style={s.store}>{item.store.name}</Text>:null}</View>
       <Text style={s.cardTitle} numberOfLines={2}>{item.title||'Annonce'}</Text>
       <Text style={s.price}>{money(item.priceMinor,item.currency)}</Text>
       <Text style={s.meta}>{item.city||'France'} · {item.performance?.views30??0} vues / 30 j · {item.performance?.favorites??0} favoris</Text>
       {item.promotions?.length?<Text style={s.promo}>⚡ {item.promotions.map(x=>x.name).join(' · ')}</Text>:null}
      </View>
     </Pressable>
    )}
   />
  </SafeAreaView>
 )
}

function Action({label,onPress,primary,danger}:{label:string;onPress:()=>void;primary?:boolean;danger?:boolean}){return <Pressable style={[s.action,primary&&s.actionPrimary,danger&&s.actionDanger]} onPress={onPress}><Text style={[s.actionText,primary&&s.actionTextPrimary,danger&&s.actionTextDanger]}>{label}</Text></Pressable>}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:PA.bg},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12,padding:24,backgroundColor:PA.bg},head:{padding:14,flexDirection:'row',alignItems:'center',gap:10},back:{width:40,height:40,borderRadius:20,backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,alignItems:'center',justifyContent:'center'},backText:{fontSize:29,lineHeight:30,color:PA.ink},eyebrow:{fontSize:9,fontWeight:'900',letterSpacing:1,color:PA.primary},title:{fontSize:23,fontWeight:'900',color:PA.ink},selectAll:{fontSize:9.5,fontWeight:'900',color:PA.primary},error:{marginHorizontal:14,marginBottom:8,padding:10,borderRadius:12,backgroundColor:'#fff0f0',color:PA.danger,fontSize:10.5},bulk:{marginHorizontal:14,marginBottom:8,padding:12,borderRadius:17,backgroundColor:'#fff',borderWidth:1,borderColor:'#cbc5ff'},bulkTitle:{fontSize:11,fontWeight:'900',color:PA.ink},bulkRow:{gap:7,paddingTop:8},bulkNote:{fontSize:9.5,lineHeight:14,color:PA.muted,marginTop:8},action:{paddingHorizontal:11,minHeight:35,borderRadius:10,borderWidth:1,borderColor:PA.line,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},actionPrimary:{backgroundColor:PA.primary,borderColor:PA.primary},actionDanger:{borderColor:'#f0caca'},actionText:{fontSize:9.5,fontWeight:'900',color:PA.ink},actionTextPrimary:{color:'#fff'},actionTextDanger:{color:PA.danger},list:{padding:14,paddingTop:5,paddingBottom:40},card:{position:'relative',flexDirection:'row',gap:11,padding:11,borderRadius:17,backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,marginBottom:9},cardOn:{borderColor:PA.primary,backgroundColor:'#fdfcff'},check:{position:'absolute',zIndex:2,right:10,top:10,width:24,height:24,borderRadius:12,borderWidth:1,borderColor:'#c9c9d4',backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},checkOn:{backgroundColor:PA.primary,borderColor:PA.primary},checkText:{fontSize:12,fontWeight:'900',color:'#fff'},image:{width:82,height:82,borderRadius:12,backgroundColor:'#eee'},imageEmpty:{width:82,height:82,borderRadius:12,backgroundColor:'#efedff',alignItems:'center',justifyContent:'center'},imageEmptyText:{fontSize:18,fontWeight:'900',color:PA.primary},copy:{flex:1,minWidth:0,paddingRight:23},row:{flexDirection:'row',gap:6,alignItems:'center'},status:{fontSize:8.5,fontWeight:'900',color:PA.primary,textTransform:'uppercase'},store:{fontSize:8.5,fontWeight:'800',color:PA.muted},cardTitle:{fontSize:13.5,fontWeight:'900',color:PA.ink,marginTop:4},price:{fontSize:14,fontWeight:'900',color:PA.ink,marginTop:5},meta:{fontSize:9.5,color:PA.muted,marginTop:4},promo:{fontSize:9.5,fontWeight:'800',color:'#a16207',marginTop:4},empty:{padding:40,alignItems:'center'},emptyTitle:{fontSize:17,fontWeight:'900',color:PA.ink},primary:{minHeight:46,paddingHorizontal:18,borderRadius:14,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center'},primaryText:{fontSize:11,fontWeight:'900',color:'#fff'}});