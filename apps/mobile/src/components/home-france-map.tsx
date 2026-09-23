import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { PA } from '../constants/theme';
import { AppIcon } from './app-icon';

type Point={x:number;y:number};
type City={name:string;x:number;y:number;tx:number;ty:number;featured?:boolean};
type Curve={p0:Point;p1:Point;p2:Point;p3:Point};
const W=1796,H=1797;
const cities:City[]=[
  {name:'Lille',x:1017,y:291,tx:1048,ty:270},
  {name:'Paris',x:938,y:589,tx:970,ty:572,featured:true},
  {name:'Rennes',x:485,y:710,tx:360,ty:692},
  {name:'Nantes',x:499,y:855,tx:365,ty:875},
  {name:'Bordeaux',x:609,y:1228,tx:455,ty:1260},
  {name:'Toulouse',x:836,y:1415,tx:690,ty:1455},
  {name:'Lyon',x:1216,y:1085,tx:1250,ty:1123,featured:true},
  {name:'Marseille',x:1276,y:1461,tx:1315,ty:1510},
  {name:'Nice',x:1489,y:1399,tx:1522,ty:1428},
  {name:'Strasbourg',x:1544,y:636,tx:1580,ty:620},
];
const parisLyon:Curve={p0:{x:938,y:589},p1:{x:1040,y:660},p2:{x:1165,y:860},p3:{x:1216,y:1085}};
const lyonMarseille:Curve={p0:{x:1216,y:1085},p1:{x:1270,y:1188},p2:{x:1300,y:1335},p3:{x:1276,y:1461}};
const routePaths=[
  'M938 589 C1040 660 1165 860 1216 1085',
  'M1216 1085 C1270 1188 1300 1335 1276 1461',
  'M609 1228 C625 970 745 730 938 589',
  'M836 1415 C965 1335 1090 1215 1216 1085',
];

function bezierPoint(curve:Curve,t:number){
  const u=1-t;
  const b0=u*u*u,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t;
  return {x:b0*curve.p0.x+b1*curve.p1.x+b2*curve.p2.x+b3*curve.p3.x,y:b0*curve.p0.y+b1*curve.p1.y+b2*curve.p2.y+b3*curve.p3.y};
}
function animatedCurve(curve:Curve,phase:Animated.Value,size:number,reverse=false){
  const input=Array.from({length:25},(_,i)=>i/24);
  const points=input.map(t=>bezierPoint(curve,reverse?1-t:t));
  return {
    translateX:phase.interpolate({inputRange:input,outputRange:points.map(p=>p.x/W*size),extrapolate:'clamp'}),
    translateY:phase.interpolate({inputRange:input,outputRange:points.map(p=>p.y/H*size),extrapolate:'clamp'}),
  };
}
function looping(value:Animated.Value,duration:number,delay=0){
  value.setValue(0);
  const animation=Animated.loop(Animated.sequence([
    delay?Animated.delay(delay):Animated.delay(0),
    Animated.timing(value,{toValue:1,duration,useNativeDriver:true}),
    Animated.timing(value,{toValue:0,duration:1,useNativeDriver:true}),
  ]));
  animation.start();
  return animation;
}

export function HomeFranceMap({primary=PA.primary,cardRadius=20,compact=false}:{title?:string;subtitle?:string;primary?:string;cardRadius?:number;compact?:boolean}){
  const router=useRouter();
  const{width}=useWindowDimensions();
  const mapSize=Math.max(compact?270:300,Math.min(compact?440:600,width-24));
  const[packageA]=useState(()=>new Animated.Value(0));
  const[moneyA]=useState(()=>new Animated.Value(0));
  const[packageB]=useState(()=>new Animated.Value(0));
  const[moneyB]=useState(()=>new Animated.Value(0));
  useEffect(()=>{
    const a=looping(packageA,6400,0),b=looping(moneyA,6400,3100),c=looping(packageB,7000,1600),d=looping(moneyB,7000,4700);
    return()=>{a.stop();b.stop();c.stop();d.stop()};
  },[packageA,moneyA,packageB,moneyB]);
  const pa=useMemo(()=>animatedCurve(parisLyon,packageA,mapSize),[packageA,mapSize]);
  const ma=useMemo(()=>animatedCurve(parisLyon,moneyA,mapSize,true),[moneyA,mapSize]);
  const pb=useMemo(()=>animatedCurve(lyonMarseille,packageB,mapSize),[packageB,mapSize]);
  const mb=useMemo(()=>animatedCurve(lyonMarseille,moneyB,mapSize,true),[moneyB,mapSize]);
  const stackShift=-8;
  const hit=(city:City)=>({left:city.x/W*mapSize-25+stackShift,top:city.y/H*mapSize-25});

  return <View style={s.section}>
    <View style={[s.mapCard,{width:mapSize,height:mapSize,borderRadius:cardRadius}]}>
      <Svg width={mapSize} height={mapSize} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="paMapZone" cx="48%" cy="45%" rx="50%" ry="50%" fx="48%" fy="45%">
            <Stop offset="0%" stopColor={primary} stopOpacity={0.10}/>
            <Stop offset="52%" stopColor={primary} stopOpacity={0.035}/>
            <Stop offset="76%" stopColor={primary} stopOpacity={0}/>
            <Stop offset="100%" stopColor={primary} stopOpacity={0}/>
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={mapSize} height={mapSize} fill="url(#paMapZone)"/>
      </Svg>
      <View style={[s.stack,{width:mapSize,height:mapSize,transform:[{translateX:stackShift}]}]}>
        <Image source={require('../../assets/images/france-home-map.svg')} style={StyleSheet.absoluteFill} contentFit="contain" transition={0}/>
        <Svg width={mapSize} height={mapSize} viewBox={`0 0 ${W} ${H}`} style={StyleSheet.absoluteFill} pointerEvents="none">
          <G fill="none" stroke={primary} strokeWidth={7} strokeLinecap="round" opacity={0.24}>
            {routePaths.map(path=><Path key={path} d={path}/>) }
          </G>
          {cities.map(city=><G key={city.name}>
            <Circle cx={city.x} cy={city.y} r={city.featured?34:25} fill="#fff" stroke={primary} strokeWidth={city.featured?7:5} opacity={0.96}/>
            <Circle cx={city.x} cy={city.y} r={city.featured?15:10} fill={primary}/>
            <SvgText x={city.tx} y={city.ty} fontSize={city.featured?43:39} fontWeight="900" fill="#fff" stroke="#fff" strokeWidth={8} strokeLinejoin="round">{city.name}</SvgText><SvgText x={city.tx} y={city.ty} fontSize={city.featured?43:39} fontWeight="900" fill={city.featured?primary:'#343243'}>{city.name}</SvgText>
          </G>)}
        </Svg>
        <View pointerEvents="none" style={[s.logoMarker,{backgroundColor:primary,left:1010/W*mapSize-19,top:895/H*mapSize-14}]}><Image source={require('../../assets/images/site-white-logo.svg')} style={s.logoMarkerImage} contentFit="contain" transition={0}/></View>
        <Animated.View pointerEvents="none" style={[s.parcel,{backgroundColor:primary,transform:[{translateX:pa.translateX},{translateY:pa.translateY},{translateX:-15},{translateY:-15}]}]}><AppIcon name="box" size={12} color="#fff"/></Animated.View>
        <Animated.View pointerEvents="none" style={[s.money,{borderColor:'#ddd8ff',transform:[{translateX:ma.translateX},{translateY:ma.translateY},{translateX:-14},{translateY:-14}]}]}><Text style={[s.moneyText,{color:primary}]}>€</Text></Animated.View>
        <Animated.View pointerEvents="none" style={[s.parcel,{backgroundColor:primary,transform:[{translateX:pb.translateX},{translateY:pb.translateY},{translateX:-15},{translateY:-15}]}]}><AppIcon name="box" size={12} color="#fff"/></Animated.View>
        <Animated.View pointerEvents="none" style={[s.money,{borderColor:'#ddd8ff',transform:[{translateX:mb.translateX},{translateY:mb.translateY},{translateX:-14},{translateY:-14}]}]}><Text style={[s.moneyText,{color:primary}]}>€</Text></Animated.View>
      </View>
      <View pointerEvents="none" style={[s.pointer,{left:'70%',top:'58%'}]}><Svg width={38} height={46} viewBox="0 0 48 58"><Path d="M20 3c3 0 5 2 5 5v17l3-4c2-2 5-2 7 0l7 7c2 2 3 5 2 8l-3 10c-1 5-6 9-11 9H19c-4 0-8-2-10-6L3 37c-1-3 0-6 3-7 2-1 5 0 6 2l3 5V8c0-3 2-5 5-5Z" fill="#fff" stroke={primary} strokeWidth={3}/><Path d="M15 26V8c0-3 2-5 5-5s5 2 5 5v17" fill="none" stroke={primary} strokeWidth={3}/></Svg></View>
      {cities.map(city=><Pressable key={city.name} accessibilityRole="button" accessibilityLabel={`Voir les annonces à ${city.name}`} hitSlop={7} onPress={()=>router.push(`/search?city=${encodeURIComponent(city.name)}` as never)} style={[s.cityHit,hit(city)]}/>) }
    </View>
  </View>;
}

const s=StyleSheet.create({
  section:{marginTop:0,marginBottom:12,alignItems:'center'},
  mapCard:{position:'relative',overflow:'hidden',borderWidth:1,borderColor:'#ebe8f7',backgroundColor:'#fff',shadowColor:'#261f53',shadowOpacity:.045,shadowRadius:16,shadowOffset:{width:0,height:8},elevation:2},
  stack:{position:'absolute',left:0,top:0},
  logoMarker:{position:'absolute',zIndex:18,width:38,height:28,borderRadius:10,borderWidth:1.2,borderColor:'#fff',alignItems:'center',justifyContent:'center',shadowColor:'#251f56',shadowOpacity:.20,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:4},
  logoMarkerImage:{width:24,height:14},
  cityHit:{position:'absolute',width:50,height:50,borderRadius:25,zIndex:30},
  parcel:{position:'absolute',left:0,top:0,zIndex:20,width:30,height:30,borderRadius:10,alignItems:'center',justifyContent:'center',shadowColor:PA.primary,shadowOpacity:.24,shadowRadius:7,shadowOffset:{width:0,height:4},elevation:4},
  money:{position:'absolute',left:0,top:0,zIndex:19,width:28,height:28,borderRadius:14,backgroundColor:'#fff',borderWidth:1,alignItems:'center',justifyContent:'center',shadowColor:PA.primary,shadowOpacity:.18,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:3},
  moneyText:{fontSize:13,fontWeight:'900'},
  pointer:{position:'absolute',zIndex:24,transform:[{scale:.66},{rotate:'-6deg'}],shadowColor:'#332b6b',shadowOpacity:.12,shadowRadius:6,shadowOffset:{width:0,height:3}},
});
