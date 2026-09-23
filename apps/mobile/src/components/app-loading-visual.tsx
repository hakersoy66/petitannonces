import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

const PURPLE='#5b4cf0';

export function AppLoadingVisual(){
  const[phase]=useState(()=>new Animated.Value(0));
  useEffect(()=>{
    const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:1000,useNativeDriver:true}));
    loop.start();
    return()=>loop.stop();
  },[phase]);
  const dots=[
    phase.interpolate({inputRange:[0,.18,.36,1],outputRange:[.32,1,.32,.32]}),
    phase.interpolate({inputRange:[0,.20,.38,.56,1],outputRange:[.32,.32,1,.32,.32]}),
    phase.interpolate({inputRange:[0,.42,.60,.78,1],outputRange:[.32,.32,1,.32,.32]}),
  ];
  return <View style={s.content}>
    <Image source={require('../../assets/images/site-white-logo.svg')} style={s.logo} contentFit="contain"/>
    <View style={s.dots} accessibilityElementsHidden>{dots.map((opacity,i)=><Animated.View key={i} style={[s.dot,{opacity}]}/>)}</View>
    <Text style={s.text}>Chargement des annonces…</Text>
  </View>;
}

export const appLoadingStyles=StyleSheet.create({
  screen:{flex:1,backgroundColor:PURPLE,alignItems:'center',justifyContent:'center'},
});

const s=StyleSheet.create({
  content:{alignItems:'center',justifyContent:'center',transform:[{translateY:-28}]},
  logo:{width:176,height:98},
  dots:{height:18,marginTop:24,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},
  dot:{width:7,height:7,borderRadius:4,backgroundColor:'rgba(255,255,255,.98)'},
  text:{marginTop:11,color:'rgba(255,255,255,.92)',fontSize:12,fontWeight:'800',letterSpacing:.18},
});