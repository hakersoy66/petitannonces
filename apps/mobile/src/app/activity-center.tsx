import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PA } from '../constants/theme';
import { AppIcon } from '../components/app-icon';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { appRouteFromNotification, usePush } from '../lib/push';
import { money } from '../lib/format';

type N={id:string;kind:string;title:string;body:string;actionUrl?:string|null;metadata?:Record<string,unknown>|null;readAt?:string|null;createdAt:string};
type A={id:string;type:string;occurredAt:string;title:string;description:string;conversationId?:string;offerId?:string;orderId?:string;status?:string;amountMinor?:number;currency?:string;listing?:{id:string;title?:string|null;slug?:string|null}};
type Prefs={messages:boolean;offers:boolean;orders:boolean;promotions:boolean;savedSearches:boolean;security:boolean;favorites:boolean};
type Mode='notifications'|'activity';
type Group='all'|'messages'|'searches'|'favorites'|'sales'|'system';

const defaultPrefs:Prefs={messages:true,offers:true,orders:true,promotions:false,savedSearches:true,security:true,favorites:true};
const kindLabel:Record<string,string>={MESSAGE:'Message',OFFER:'Offre',SYSTEM:'Système',LISTING:'Annonce / vente',SEARCH:'Recherche',PAYMENT:'Paiement',ORDER:'Commande',WALLET:'Portefeuille',SECURITY:'Sécurité'};
const groupLabels:Record<Group,string>={all:'Toutes',messages:'Messages',searches:'Recherches',favorites:'Favoris',sales:'Ventes',system:'Système'};
const iconFor=(kind:string)=>(kind==='MESSAGE'?'comments':kind==='OFFER'?'handshake':kind==='PAYMENT'||kind==='PAYOUT'||kind==='WALLET'?'euro-sign':kind==='PURCHASE'?'bag-shopping':kind==='SALE'?'box':kind==='LISTING'?'rectangle-list':kind==='SEARCH'?'magnifying-glass':kind==='SECURITY'?'shield-halved':'bell') as any;

function groupFor(n:N):Exclude<Group,'all'>{
  const marker=String(n.metadata?.source??n.metadata?.purpose??'').toUpperCase();
  if(n.kind==='MESSAGE')return'messages';
  if(n.kind==='SEARCH')return'searches';
  if(marker.includes('FAVORITE')||marker.includes('FOLLOWED'))return'favorites';
  if(n.kind==='OFFER'||n.kind==='WALLET'||n.kind==='LISTING'||n.kind==='PAYMENT'||n.kind==='ORDER')return'sales';
  return'system';
}

export default function ActivityCenter(){
  const params=useLocalSearchParams<{tab?:string}>();
  const{user,token,loading:authLoading}=useAuth();
  const push=usePush();
  const[mode,setMode]=useState<Mode>(params.tab==='activity'?'activity':'notifications');
  const[notifications,setNotifications]=useState<N[]>([]);
  const[activity,setActivity]=useState<A[]>([]);
  const[unread,setUnread]=useState(0);
  const[loading,setLoading]=useState(true);
  const[refreshing,setRefreshing]=useState(false);
  const[error,setError]=useState('');
  const[filter,setFilter]=useState<Group>('all');
  const[prefs,setPrefs]=useState<Prefs>(defaultPrefs);
  const[prefsReady,setPrefsReady]=useState(false);
  const[savingGroup,setSavingGroup]=useState<Group|null>(null);

  const load=useCallback(async(soft=false)=>{
    if(!token){setLoading(false);return}
    if(soft)setRefreshing(true);else setLoading(true);
    setError('');
    try{
      const[n,a,p]=await Promise.all([
        apiRequest<{notifications:N[];unread:number}>('/account/notifications?limit=100',{token}),
        apiRequest<{items:A[]}>('/account/activity?limit=80',{token}),
        apiRequest<{preferences?:Partial<Prefs>}>('/notifications/preferences',{token})
      ]);
      setNotifications(n.notifications??[]);
      setUnread(Math.max(0,Number(n.unread??0)));
      setActivity(a.items??[]);
      setPrefs({...defaultPrefs,...(p.preferences??{})});
      setPrefsReady(true);
      await Notifications.setBadgeCountAsync(Math.max(0,Number(n.unread??0))).catch(()=>false);
    }catch(e){
      if(e instanceof ApiError&&e.status===401){router.replace('/auth/login');return}
      setError('Impossible de charger votre centre d’activité.');
    }finally{setLoading(false);setRefreshing(false)}
  },[token]);

  useFocusEffect(useCallback(()=>{void load();return()=>{}},[load]));

  async function markRead(item:N,open=true){
    if(!token)return;
    const orderId=item.metadata?.orderId;
    const raw=item.actionUrl||(typeof orderId==='string'?'/commandes/'+orderId:'');
    const target=appRouteFromNotification(raw);
    try{
      const r=await apiRequest<{unread:number}>('/account/notifications/'+encodeURIComponent(item.id)+'/read',{method:'POST',token});
      const next=Math.max(0,Number(r.unread??Math.max(0,unread-1)));
      setUnread(next);
      setNotifications(v=>v.filter(x=>x.id!==item.id));
      await Notifications.setBadgeCountAsync(next).catch(()=>false);
    }catch{
      setError('Impossible de mettre à jour cette notification.');
      return;
    }
    if(open)router.push(target as never);
  }

  async function markAll(){
    if(!token||unread<1)return;
    try{
      await apiRequest('/account/notifications/read-all',{method:'POST',token,body:{confirm:'ALL'}});
      setNotifications([]);
      setUnread(0);
      await Notifications.setBadgeCountAsync(0).catch(()=>false);
    }catch{setError('Impossible de marquer toutes les notifications comme lues.')}
  }

  function openActivity(item:A){
    if(item.orderId)return router.push(('/orders/'+item.orderId) as never);
    if(item.conversationId)return router.push(('/messages/'+item.conversationId) as never);
    if(item.listing?.slug)return router.push(('/annonce/'+item.listing.slug) as never);
  }

  function groupEnabled(group:Exclude<Group,'all'>){
    if(group==='messages')return prefs.messages;
    if(group==='searches')return prefs.savedSearches;
    if(group==='favorites')return prefs.favorites;
    if(group==='sales')return prefs.offers&&prefs.orders;
    return prefs.security;
  }

  async function toggleGroup(group:Exclude<Group,'all'>){
    if(!token||savingGroup)return;
    const previous=prefs;
    const target=!groupEnabled(group);
    const next={...prefs};
    if(group==='messages')next.messages=target;
    else if(group==='searches')next.savedSearches=target;
    else if(group==='favorites')next.favorites=target;
    else if(group==='sales'){next.offers=target;next.orders=target}
    else next.security=target;
    setPrefs(next);
    setSavingGroup(group);
    setError('');
    try{await apiRequest('/notifications/preferences',{method:'PUT',token,body:next})}
    catch{setPrefs(previous);setError('Impossible d’enregistrer cette préférence.')}
    finally{setSavingGroup(null)}
  }

  async function togglePush(){
    if(push.busy)return;
    if(push.permission==='denied'&&!push.subscribed){await Linking.openSettings();return}
    const ok=push.subscribed?await push.disablePush():await push.enablePush();
    if(!ok)setError('Impossible de modifier les notifications sur cet appareil.');
  }

  const counts=useMemo(()=>{
    const out:Record<Group,number>={all:notifications.length,messages:0,searches:0,favorites:0,sales:0,system:0};
    for(const item of notifications)out[groupFor(item)]++;
    return out;
  },[notifications]);
  const visibleNotifications=filter==='all'?notifications:notifications.filter(n=>groupFor(n)===filter);
  const data=mode==='notifications'?visibleNotifications:activity;

  if(authLoading||loading)return <SafeAreaView style={s.center}><ActivityIndicator color={PA.primary}/></SafeAreaView>;
  if(!user||!token)return <SafeAreaView style={s.center}><Text style={s.title}>Notifications & activité</Text><Pressable style={s.primary} onPress={()=>router.replace('/auth/login')}><Text style={s.primaryText}>Se connecter</Text></Pressable></SafeAreaView>;

  return <SafeAreaView style={s.safe} edges={['top']}>
    <FlatList
      data={data as any[]}
      keyExtractor={x=>x.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void load(true)} tintColor={PA.primary}/>}
      contentContainerStyle={data.length?s.list:s.emptyList}
      ListHeaderComponent={<>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Retour" style={s.back} onPress={()=>router.back()}><AppIcon name="arrow-left" size={14} color={PA.ink}/></Pressable>
          <View style={{flex:1}}><Text style={s.eyebrow}>MON COMPTE</Text><Text style={s.title}>Notifications</Text><Text style={s.lead}>Messages, recherches, favoris, ventes et alertes système au même endroit.</Text></View>
          {unread>0?<View style={s.badge}><Text style={s.badgeText}>{unread>99?'99+':unread}</Text></View>:null}
        </View>
        <View style={s.tabs}>
          <Pressable style={[s.tab,mode==='notifications'&&s.tabOn]} onPress={()=>setMode('notifications')}><Text style={[s.tabText,mode==='notifications'&&s.tabTextOn]}>Notifications</Text></Pressable>
          <Pressable style={[s.tab,mode==='activity'&&s.tabOn]} onPress={()=>setMode('activity')}><Text style={[s.tabText,mode==='activity'&&s.tabTextOn]}>Activité</Text></Pressable>
        </View>
        {mode==='notifications'?<>
          <View style={s.settings}>
            <View style={s.settingRow}>
              <View style={s.settingCopy}><Text style={s.settingTitle}>Notifications sur cet appareil</Text><Text style={s.settingText}>{push.subscribed?'Notifications activées.':push.permission==='denied'?'Notifications bloquées dans les réglages de l’appareil.':'Notifications désactivées sur cet appareil.'}</Text></View>
              <Switch value={push.subscribed} disabled={push.busy||!push.projectReady} onValueChange={()=>void togglePush()}/>
            </View>
            {(['messages','searches','favorites','sales','system'] as const).map(group=><View key={group} style={s.settingRow}>
              <View style={s.settingCopy}><Text style={s.settingTitle}>{groupLabels[group]}</Text><Text style={s.settingText}>{group==='messages'?'Nouveaux messages':group==='searches'?'Recherches enregistrées':group==='favorites'?'Favoris et comptes suivis':group==='sales'?'Offres, annonces, commandes et portefeuille':'Sécurité et informations système'}</Text></View>
              <Switch value={groupEnabled(group)} disabled={!prefsReady||savingGroup!==null} onValueChange={()=>void toggleGroup(group)}/>
            </View>)}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
            {(['all','messages','searches','favorites','sales','system'] as Group[]).map(group=><Pressable key={group} style={[s.filter,filter===group&&s.filterOn]} onPress={()=>setFilter(group)}><Text style={[s.filterText,filter===group&&s.filterTextOn]}>{groupLabels[group]} · {counts[group]}</Text></Pressable>)}
          </ScrollView>
          <View style={s.toolbar}><Text style={s.toolbarText}>{unread} non lue{unread>1?'s':''}</Text>{unread>0?<Pressable style={s.clearButton} onPress={()=>void markAll()}><AppIcon name="circle-check" size={12} color={PA.primary}/><Text style={s.markAll}>Tout marquer comme lu</Text></Pressable>:null}</View>
        </>:null}
        {error?<Text style={s.error}>{error}</Text>:null}
      </>}
      ListEmptyComponent={<View style={s.empty}><View style={s.emptyIcon}><AppIcon name="circle-check" size={24} color={PA.success}/></View><Text style={s.emptyTitle}>{mode==='notifications'?'Vous êtes à jour':'Aucune activité récente'}</Text><Text style={s.muted}>{mode==='notifications'?'Aucune notification pour le moment.':'Vos messages, offres, achats, ventes et versements apparaîtront ici.'}</Text></View>}
      renderItem={({item})=>mode==='notifications'?<NotificationRow item={item as N} open={()=>void markRead(item as N,true)} mark={()=>void markRead(item as N,false)}/>:<ActivityRow item={item as A} open={()=>openActivity(item as A)}/>}
    />
  </SafeAreaView>;
}

function NotificationRow({item,open,mark}:{item:N;open:()=>void;mark:()=>void}){
  return <Pressable style={[s.card,s.unreadCard]} onPress={open}>
    <View style={s.icon}><AppIcon name={iconFor(item.kind)} size={16}/></View>
    <View style={s.copy}><View style={s.rowTop}><Text style={s.kind}>{kindLabel[item.kind]??item.kind}</Text><View style={s.dot}/></View><Text style={s.cardTitle}>{item.title}</Text><Text style={s.body}>{item.body}</Text><Text style={s.date}>{new Date(item.createdAt).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'})}</Text><Pressable hitSlop={8} onPress={e=>{e.stopPropagation();mark()}}><Text style={s.readLink}>Marquer comme lu · retirer</Text></Pressable></View>
    <AppIcon name="chevron-right" size={12} color={PA.muted}/>
  </Pressable>;
}

function ActivityRow({item,open}:{item:A;open:()=>void}){
  const clickable=Boolean(item.orderId||item.conversationId||item.listing?.slug);
  return <Pressable disabled={!clickable} style={s.card} onPress={open}><View style={s.icon}><AppIcon name={iconFor(item.type)} size={16}/></View><View style={s.copy}><Text style={s.kind}>{item.type==='PAYOUT'?'VERSEMENT':item.type}</Text><Text style={s.cardTitle}>{item.title}</Text><Text style={s.body}>{item.description}</Text>{typeof item.amountMinor==='number'?<Text style={s.amount}>{money(item.amountMinor,item.currency||'EUR')}</Text>:null}<Text style={s.date}>{new Date(item.occurredAt).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'})}</Text></View>{clickable?<AppIcon name="chevron-right" size={12} color={PA.muted}/>:null}</Pressable>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:'#f7f7fb'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12,padding:28,backgroundColor:'#f7f7fb'},
 header:{paddingHorizontal:15,paddingTop:15,paddingBottom:10,flexDirection:'row',alignItems:'flex-start',gap:10},back:{width:40,height:40,borderRadius:20,backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,alignItems:'center',justifyContent:'center'},eyebrow:{fontSize:9.5,fontWeight:'900',letterSpacing:1.1,color:PA.primary},title:{fontSize:25,fontWeight:'900',letterSpacing:-.6,color:PA.ink,marginTop:2},lead:{fontSize:11.5,lineHeight:16,color:PA.muted,marginTop:4},badge:{minWidth:32,height:32,paddingHorizontal:8,borderRadius:16,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center'},badgeText:{fontSize:11,fontWeight:'900',color:'#fff'},
 tabs:{marginHorizontal:14,flexDirection:'row',padding:4,borderRadius:15,backgroundColor:'#e9eaf0'},tab:{flex:1,minHeight:39,borderRadius:11,alignItems:'center',justifyContent:'center'},tabOn:{backgroundColor:'#fff'},tabText:{fontSize:11,fontWeight:'800',color:PA.muted},tabTextOn:{color:PA.ink},
 settings:{margin:14,marginBottom:8,backgroundColor:'#fff',borderWidth:1,borderColor:'#e7e7ee',borderRadius:20,overflow:'hidden'},settingRow:{minHeight:62,paddingHorizontal:14,paddingVertical:10,flexDirection:'row',alignItems:'center',gap:10,borderBottomWidth:1,borderBottomColor:'#f0f0f4'},settingCopy:{flex:1},settingTitle:{fontSize:12.5,fontWeight:'900',color:PA.ink},settingText:{fontSize:10.5,lineHeight:15,color:PA.muted,marginTop:2},
 filters:{paddingHorizontal:14,paddingBottom:8,gap:7},filter:{minHeight:34,paddingHorizontal:12,borderRadius:17,backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,alignItems:'center',justifyContent:'center'},filterOn:{backgroundColor:PA.ink,borderColor:PA.ink},filterText:{fontSize:10,fontWeight:'900',color:PA.muted},filterTextOn:{color:'#fff'},
 toolbar:{paddingHorizontal:16,paddingVertical:8,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},toolbarText:{fontSize:10.5,fontWeight:'800',color:PA.muted},clearButton:{flexDirection:'row',alignItems:'center',gap:5},markAll:{fontSize:10.5,fontWeight:'900',color:PA.primary},error:{marginHorizontal:14,marginBottom:8,padding:10,borderRadius:12,backgroundColor:'#fff0f0',color:PA.danger,fontSize:11},
 list:{paddingBottom:36},emptyList:{flexGrow:1,paddingBottom:36},empty:{alignItems:'center',justifyContent:'center',padding:38},emptyIcon:{width:50,height:50,borderRadius:25,alignItems:'center',justifyContent:'center',backgroundColor:'#eaf9f2'},emptyTitle:{fontSize:18,fontWeight:'900',color:PA.ink,marginTop:12},muted:{fontSize:11.5,lineHeight:17,color:PA.muted,textAlign:'center',marginTop:5},
 card:{backgroundColor:'#fff',borderWidth:1,borderColor:PA.line,borderRadius:18,padding:13,marginHorizontal:14,marginBottom:9,flexDirection:'row',gap:11,alignItems:'flex-start'},unreadCard:{borderColor:'#cfcafc',backgroundColor:'#fdfcff'},icon:{width:42,height:42,borderRadius:13,backgroundColor:'#efedff',alignItems:'center',justifyContent:'center'},copy:{flex:1,minWidth:0},rowTop:{flexDirection:'row',alignItems:'center',gap:6},kind:{fontSize:8.5,fontWeight:'900',letterSpacing:.7,color:PA.primary},dot:{width:7,height:7,borderRadius:4,backgroundColor:PA.primary},cardTitle:{fontSize:13.5,fontWeight:'900',color:PA.ink,marginTop:3},body:{fontSize:11,lineHeight:16,color:PA.muted,marginTop:4},date:{fontSize:9.5,color:'#9a9aa5',marginTop:7},readLink:{fontSize:10,fontWeight:'900',color:PA.primary,marginTop:6},amount:{fontSize:13,fontWeight:'900',color:PA.ink,marginTop:6},
 primary:{minHeight:47,paddingHorizontal:22,borderRadius:14,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center'},primaryText:{fontSize:11,fontWeight:'900',color:'#fff'}
});

[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]