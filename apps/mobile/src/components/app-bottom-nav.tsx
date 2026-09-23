import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PA } from '../constants/theme';
import { useAuth } from '../lib/auth';
import { apiRequest } from '../lib/api';
import { useMobileUi } from '../lib/mobile-ui';
import { AppIcon } from './app-icon';

type NavId='home'|'search'|'sell'|'messages'|'account';

export function AppBottomNav({active,embedded=false}:{active?:NavId;embedded?:boolean}){
  const insets=useSafeAreaInsets();
  const {user,token}=useAuth();
  const {config}=useMobileUi();
  const primary=config.theme.primary||PA.primary;
  const freshRef=useRef(0);
  const [unreadMessages,setUnreadMessages]=useState(0);

  useEffect(()=>{
    if(!token){setUnreadMessages(0);return}
    let alive=true;
    const sync=()=>apiRequest<{unreadConversations?:number}>('/account/message-summary',{token}).then(p=>{if(alive)setUnreadMessages(Math.max(0,Number(p.unreadConversations??0)))}).catch(()=>undefined);
    void sync();
    const timer=setInterval(()=>void sync(),30000);
    return()=>{alive=false;clearInterval(timer)};
  },[token]);

  const go=(id:NavId)=>{
    if(id==='sell'){freshRef.current+=1;router.replace({pathname:'/sell',params:{direct:'0',fresh:String(freshRef.current),listingId:''}} as never);return}
    router.replace((id==='home'?'/':id==='search'?'/search':id==='messages'?'/messages':'/account') as never);
  };

  const iconById:Record<NavId,'home'|'search'|'plus'|'comments'|'user'>={home:'home',search:'search',sell:'plus',messages:'comments',account:'user'};
  const fallbackLabels:Record<NavId,string>={home:'Accueil',search:'Recherche',sell:'',messages:'Messages',account:'Mon espace'};
  const remoteItems=(config.bottomNav.items??[]).filter(item=>item.enabled).sort((a,b)=>a.order-b.order);
  const items:[NavId,'home'|'search'|'plus'|'comments'|'user',string][]=(remoteItems.length?remoteItems.map(item=>[item.id,iconById[item.id],item.id==='sell'?'':item.label||fallbackLabels[item.id]] as [NavId,'home'|'search'|'plus'|'comments'|'user',string]):([
    ['home','home','Accueil'],
    ['search','search','Recherche'],
    ['sell','plus',''],
    ['messages','comments','Messages'],
    ['account','user','Mon espace'],
  ] as [NavId,'home'|'search'|'plus'|'comments'|'user',string][]));

  return <View style={[embedded?s.embedded:s.wrap,{paddingBottom:Math.max(insets.bottom,4)}]}>
    <View style={s.bar}>
      {items.map(([id,icon,label])=>{
        const on=active===id;
        const a11yLabel=id==='sell'?'Déposer une annonce':id==='messages'&&unreadMessages>0?`Messages, ${unreadMessages>99?'plus de 99':unreadMessages} conversation${unreadMessages>1?'s':''} non lue${unreadMessages>1?'s':''}`:label;
        if(id==='sell')return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={a11yLabel} accessibilityState={{selected:on}} style={s.item} onPress={()=>go(id)}>
          <View style={[s.plus,on&&s.plusActive,{backgroundColor:primary,shadowColor:primary}]}><AppIcon name="plus" size={20} color="#fff"/></View>
        </Pressable>;
        return <Pressable key={id} accessibilityRole="tab" accessibilityLabel={a11yLabel} accessibilityState={{selected:on}} style={[s.item,on&&s.itemActive]} onPress={()=>go(id)}>
          <View style={s.iconWrap} accessible={false}>
            {id==='account'&&user?.profile?.avatarUrl
              ?<Image source={{uri:user.profile.avatarUrl}} style={[s.avatar,{borderColor:on?'#b9b0ff':'#ddd9ee'}]} contentFit="cover" accessible={false}/>
              :<AppIcon name={icon} size={17} color={on?primary:'#777687'}/>}
            {id==='messages'&&unreadMessages>0?<View style={[s.count,on&&s.countActive]} accessible={false}><Text allowFontScaling={false} style={s.countText}>{unreadMessages>99?'99+':unreadMessages}</Text></View>:null}
          </View>
          <Text maxFontSizeMultiplier={1.35} style={[s.label,on&&{color:primary}]}>{label}</Text>
        </Pressable>
      })}
    </View>
  </View>
}

const s=StyleSheet.create({
  wrap:{position:'absolute',left:10,right:10,bottom:0,zIndex:70,backgroundColor:'transparent'},
  embedded:{position:'relative',zIndex:70,backgroundColor:'transparent',paddingHorizontal:10,paddingTop:0},
  bar:{height:63,borderWidth:1,borderColor:'#e0dfea',borderRadius:16,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',paddingHorizontal:4,paddingTop:0,paddingBottom:4,shadowColor:'#1a1740',shadowOpacity:.14,shadowRadius:20,shadowOffset:{width:0,height:-5},elevation:10},
  item:{flex:1,minWidth:0,height:52,borderRadius:15,alignItems:'center',justifyContent:'center',gap:4,position:'relative',transform:[{translateY:-2}]},
  itemActive:{backgroundColor:'#f4f2ff'},
  iconWrap:{width:28,height:23,alignItems:'center',justifyContent:'center',position:'relative'},
  label:{fontSize:9.5,fontWeight:'800',color:'#777687',lineHeight:11},
  plus:{width:46,height:46,borderRadius:15,alignItems:'center',justifyContent:'center',transform:[{translateY:0}],borderWidth:0,shadowOpacity:.22,shadowRadius:9,shadowOffset:{width:0,height:4},elevation:5},
  plusActive:{borderWidth:2,borderColor:'rgba(91,76,240,.13)'},
  avatar:{width:28,height:28,borderRadius:14,borderWidth:1,backgroundColor:'#fff'},
  count:{position:'absolute',top:-7,right:-9,minWidth:18,height:18,borderRadius:9,backgroundColor:'#ff4c55',paddingHorizontal:5,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#fff'},
  countActive:{borderColor:'#f4f2ff'},
  countText:{color:'#fff',fontSize:8,fontWeight:'900',lineHeight:9},
});