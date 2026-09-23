import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon } from './app-icon';
import { AppLoadingVisual, appLoadingStyles } from './app-loading-visual';

const FLAG='pa:first-run:onboarding:pwa-v1';
const PURPLE='#5b4cf0';
type IconName=Parameters<typeof AppIcon>[0]['name'];
type Slide={eyebrow:string;title:string;text:string;icon:IconName;accents:[IconName,IconName,IconName];colors:[string,string]};
const slides:Slide[]=[
  {eyebrow:'Bienvenue',title:'Petit Annonces, partout avec vous',text:'Achetez, vendez et trouvez près de chez vous depuis une expérience pensée comme une vraie application.',icon:'sparkles',accents:['magnifying-glass','location-dot','heart'],colors:['#6558f4','#493ad8']},
  {eyebrow:'Simple & rapide',title:'Publiez votre annonce en quelques minutes',text:'Ajoutez vos photos, votre prix et les informations utiles. La publication d’une annonce reste simple, guidée et gratuite.',icon:'plus',accents:['camera','list','circle-check'],colors:['#ff6972','#ef414c']},
  {eyebrow:'Achetez en confiance',title:'Paiement sécurisé et envoi suivi',text:'Payez en ligne, suivez votre envoi et profitez des protections prévues pour sécuriser les échanges entre acheteurs et vendeurs.',icon:'shield-halved',accents:['credit-card','truck','lock'],colors:['#27b790','#148c70']},
  {eyebrow:'Tout au même endroit',title:'Messages, favoris et notifications',text:'Retrouvez vos conversations, vos annonces favorites, vos alertes et votre espace personnel directement depuis l’application.',icon:'comments',accents:['bell','heart','store'],colors:['#4f83ff','#4265d8']},
  {eyebrow:'Dernière étape',title:'Activez les notifications',text:'Soyez prévenu dès qu’un message, une offre, une commande ou une mise à jour importante vous attend.',icon:'bell',accents:['comments','handshake','truck'],colors:['#ff5d68','#e83f4a']},
];

function PwaVisual({slide,small}:{slide:Slide;small:boolean}){
  const visual=small?235:300,main=small?94:118,ring1=small?165:205,ring2=small?220:272,orbit=small?42:48;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{width:visual,height:visual,alignItems:'center',justifyContent:'center',marginBottom:small?0:8}}>
    <View style={[s.ring,{width:ring2,height:ring2,borderRadius:ring2/2,borderStyle:'dashed'}]}/>
    <View style={[s.ring,{width:ring1,height:ring1,borderRadius:ring1/2}]}/>
    <View style={[s.orbit,{width:orbit,height:orbit,borderRadius:small?13:16,left:'12%',top:'27%'}]}><AppIcon name={slide.accents[0]} size={small?15:17} color={PURPLE}/></View>
    <View style={[s.orbit,{width:orbit,height:orbit,borderRadius:small?13:16,right:'8%',top:'18%'}]}><AppIcon name={slide.accents[1]} size={small?15:17} color={PURPLE}/></View>
    <View style={[s.orbit,{width:orbit,height:orbit,borderRadius:small?13:16,right:'14%',bottom:'18%'}]}><AppIcon name={slide.accents[2]} size={small?15:17} color={PURPLE}/></View>
    <LinearGradient colors={slide.colors} style={[s.mainIcon,{width:main,height:main,borderRadius:small?29:36}]}><AppIcon name={slide.icon} size={small?38:47} color="#fff"/></LinearGradient>
  </View>;
}

export function FirstRunExperience({children}:{children:ReactNode}){
  const{width,height}=useWindowDimensions();
  const[ready,setReady]=useState(false);const[first,setFirst]=useState(false);const[index,setIndex]=useState(0);const[busy,setBusy]=useState(false);const[pushState,setPushState]=useState<'idle'|'ok'|'error'>('idle');const[pageWidth,setPageWidth]=useState(width);const scroll=useRef<ScrollView>(null);
  const small=height<780;const verySmall=height<660;const last=index===slides.length-1;
  useEffect(()=>{let alive=true;void AsyncStorage.getItem(FLAG).then(done=>{if(!alive)return;setFirst(done!=='done');setReady(true)});return()=>{alive=false}},[]);
  async function finish(requestPush:boolean){
    if(requestPush){
      setBusy(true);setPushState('idle');
      try{
        if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('default',{name:'Petit Annonces',importance:Notifications.AndroidImportance.HIGH,sound:'default',showBadge:true});
        const permission=Platform.OS==='ios'
          ? await Notifications.requestPermissionsAsync({ios:{allowAlert:true,allowBadge:true,allowSound:true}})
          : await Notifications.requestPermissionsAsync();
        if(permission.status!=='granted'){setPushState('error');return}
        await Notifications.getDevicePushTokenAsync();
        setPushState('ok');
        await new Promise(resolve=>setTimeout(resolve,550));
      }catch{setPushState('error');return}finally{setBusy(false)}
    }
    await AsyncStorage.setItem(FLAG,'done');setFirst(false);
  }
  function goTo(nextIndex:number){const n=Math.max(0,Math.min(slides.length-1,nextIndex));setIndex(n);scroll.current?.scrollTo({x:pageWidth*n,animated:true})}
  function onScrollEnd(e:NativeSyntheticEvent<NativeScrollEvent>){const w=Math.max(1,e.nativeEvent.layoutMeasurement.width);setPageWidth(w);setIndex(Math.max(0,Math.min(slides.length-1,Math.round(e.nativeEvent.contentOffset.x/w))))}
  if(!ready)return <View style={appLoadingStyles.screen}><AppLoadingVisual/></View>;
  if(!first)return <>{children}</>;
  return <LinearGradient colors={['#fbfaff','#f5f3ff','#ffffff']} locations={[0,.55,1]} style={s.root}>
    <View pointerEvents="none" style={s.glowRed}/><View pointerEvents="none" style={s.glowPurple}/>
    <SafeAreaView style={s.safe}>
      <View style={[s.shell,{paddingHorizontal:22,paddingTop:verySmall?4:small?7:12,paddingBottom:verySmall?8:small?10:14}]}>
        <View style={s.brand}><Image source={require('../../assets/images/icon-production.png')} style={[s.brandIcon,small&&s.brandIconSmall]} contentFit="cover" accessible={false}/><View><Text maxFontSizeMultiplier={1.4} style={s.brandTitle}>Petit Annonces</Text><Text maxFontSizeMultiplier={1.4} style={s.brandSub}>L’application qui vous accompagne</Text></View></View>
        <ScrollView ref={scroll} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScrollEnd} decelerationRate="fast" style={s.slider} contentContainerStyle={{alignItems:'stretch'}}>
          {slides.map((slide,i)=><View key={slide.title} style={[s.slide,{width:pageWidth,transform:[{translateY:verySmall?-8:small?-16:-24}]}]}>
            <PwaVisual slide={slide} small={small}/>
            <View style={s.copy}>
              <View style={s.eyebrow}><Text style={s.eyebrowText}>{slide.eyebrow}</Text></View>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.55} style={[s.title,small&&s.titleSmall]}>{slide.title}</Text>
              <Text maxFontSizeMultiplier={1.6} style={[s.text,small&&s.textSmall]}>{slide.text}</Text>
              {i===slides.length-1?<><View style={s.notificationPoints}><View style={s.point}><AppIcon name="comments" size={12} color="#e83f4a"/><Text style={s.pointText}>Nouveaux messages</Text></View><View style={s.point}><AppIcon name="handshake" size={12} color="#e83f4a"/><Text style={s.pointText}>Offres reçues</Text></View><View style={s.point}><AppIcon name="truck" size={12} color="#e83f4a"/><Text style={s.pointText}>Suivi des commandes</Text></View></View>{pushState==='ok'?<View style={s.pushStatus}><AppIcon name="circle-check" size={12} color="#168963"/><Text style={s.pushOk}>Notifications activées</Text></View>:pushState==='error'?<Text style={s.pushError}>Impossible d’activer les notifications. Vérifiez l’autorisation système puis réessayez.</Text>:null}</>:<View style={s.swipe}><AppIcon name="arrow-left" size={13} color="#bbb8ca"/><AppIcon name="hand-pointer" size={18} color="#9391a4"/><Text style={s.swipeText}>Glissez à gauche ou à droite</Text><AppIcon name="arrow-right" size={13} color="#bbb8ca"/></View>}
            </View>
          </View>)}
        </ScrollView>
        <View style={s.footer} onLayout={e=>{const w=e.nativeEvent.layout.width;if(w>0&&Math.abs(w-pageWidth)>1)setPageWidth(w)}}>
          <View style={s.dots}>{slides.map((slide,i)=><Pressable key={slide.title} accessibilityRole="button" accessibilityLabel={`Aller à l’écran ${i+1} sur ${slides.length} : ${slide.eyebrow}`} accessibilityState={{selected:i===index}} hitSlop={8} onPress={()=>goTo(i)}><View style={[s.dot,i===index&&s.dotOn]}/></Pressable>)}</View>
          {last?<View style={s.actions}><Pressable accessibilityRole="button" accessibilityLabel="Activer plus tard" disabled={busy} style={[s.back,s.lastBack]} onPress={()=>void finish(false)}><Text maxFontSizeMultiplier={1.4} style={s.backText}>Plus tard</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={pushState==='error'?'Réessayer d’activer les notifications':'Activer les notifications'} disabled={busy} style={[s.next,s.lastNext]} onPress={()=>void finish(true)}><AppIcon name="bell" size={14} color="#fff"/><Text maxFontSizeMultiplier={1.35} style={s.nextText}>{busy?'Activation…':pushState==='error'?'Réessayer':'Activer les notifications'}</Text></Pressable></View>:<View style={s.actions}><Pressable accessibilityRole="button" accessibilityLabel="Écran précédent" accessibilityState={{disabled:index===0}} disabled={index===0} style={[s.back,index===0&&s.disabled]} onPress={()=>goTo(index-1)}><AppIcon name="chevron-left" size={13} color="#666576"/><Text maxFontSizeMultiplier={1.4} style={s.backText}>Précédent</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Écran suivant" style={s.next} onPress={()=>goTo(index+1)}><Text maxFontSizeMultiplier={1.4} style={s.nextText}>Suivant</Text><AppIcon name="chevron-right" size={13} color="#fff"/></Pressable></View>}
        </View>
      </View>
    </SafeAreaView>
  </LinearGradient>;
}

const s=StyleSheet.create({
  root:{flex:1},safe:{flex:1},shell:{flex:1},glowRed:{position:'absolute',left:-90,top:-100,width:270,height:270,borderRadius:150,backgroundColor:'rgba(255,76,85,.10)'},glowPurple:{position:'absolute',right:-100,top:30,width:300,height:300,borderRadius:160,backgroundColor:'rgba(91,76,240,.10)'},
  brand:{minHeight:54,flexDirection:'row',alignItems:'center',gap:11},brandIcon:{width:46,height:46,borderRadius:14},brandIconSmall:{width:40,height:40,borderRadius:12},brandTitle:{fontSize:14,fontWeight:'900',color:'#222232',letterSpacing:-.25},brandSub:{fontSize:10,color:'#818091',fontWeight:'700',marginTop:2},
  slider:{flex:1},slide:{flex:1,alignItems:'center',justifyContent:'center',textAlign:'center',paddingHorizontal:0,paddingVertical:2},ring:{position:'absolute',borderWidth:1,borderColor:'rgba(91,76,240,.13)'},orbit:{position:'absolute',zIndex:5,backgroundColor:'#fff',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(229,226,245,.9)',shadowColor:'#2c265a',shadowOpacity:.13,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:3},mainIcon:{zIndex:4,alignItems:'center',justifyContent:'center',shadowColor:'#4d3dd5',shadowOpacity:.28,shadowRadius:20,shadowOffset:{width:0,height:10},elevation:5},
  copy:{width:'100%',maxWidth:490,alignItems:'center'},eyebrow:{marginBottom:8,paddingHorizontal:11,paddingVertical:7,borderRadius:999,backgroundColor:'#ece9ff'},eyebrowText:{color:PURPLE,fontSize:10,fontWeight:'900',letterSpacing:.9,textTransform:'uppercase'},title:{fontSize:32,lineHeight:34,fontWeight:'900',letterSpacing:-1.3,textAlign:'center',color:'#222232'},titleSmall:{fontSize:27,lineHeight:29},text:{maxWidth:440,marginTop:15,color:'#747384',fontSize:14,lineHeight:22,textAlign:'center'},textSmall:{fontSize:12,lineHeight:18,marginTop:10},
  swipe:{height:35,marginTop:18,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},swipeArrow:{fontSize:15,color:'#bbb8ca'},swipeFinger:{fontSize:21,transform:[{rotate:'-18deg'}]},swipeText:{color:'#9391a4',fontSize:10,fontWeight:'800'},notificationPoints:{marginTop:16,flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:8},point:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:10,paddingVertical:8,borderRadius:999,borderWidth:1,borderColor:'#e7e3f4',backgroundColor:'rgba(255,255,255,.84)'},pointText:{color:'#5d5b6c',fontSize:10,fontWeight:'800'},pushStatus:{marginTop:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},pushOk:{fontSize:11,fontWeight:'900',color:'#168963'},pushError:{marginTop:10,maxWidth:330,fontSize:10,lineHeight:14,fontWeight:'800',textAlign:'center',color:'#b45309'},
  footer:{gap:12},dots:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},dot:{width:8,height:8,borderRadius:999,backgroundColor:'#d3d0df'},dotOn:{width:28,backgroundColor:PURPLE},actions:{flexDirection:'row',gap:10},back:{height:50,flex:.72,borderRadius:17,borderWidth:1,borderColor:'#e1dfe9',backgroundColor:'rgba(255,255,255,.72)',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},backText:{fontSize:13,fontWeight:'900',color:'#666576'},next:{height:50,flex:1.28,borderRadius:17,backgroundColor:PURPLE,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,shadowColor:PURPLE,shadowOpacity:.25,shadowRadius:15,shadowOffset:{width:0,height:7},elevation:4},nextText:{fontSize:13,fontWeight:'900',color:'#fff',textAlign:'center'},disabled:{opacity:.34},lastBack:{flex:.62},lastNext:{flex:1.38,backgroundColor:'#e83f4a',shadowColor:'#d93643'},
});
