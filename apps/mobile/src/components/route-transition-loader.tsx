import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PA } from '../constants/theme';
import { AppLoadingVisual } from './app-loading-visual';

export function RouteTransitionLoader(){
  const pathname=usePathname();
  const first=useRef(true);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const[visible,setVisible]=useState(false);

  useEffect(()=>{
    if(first.current){first.current=false;return}
    if(timer.current)clearTimeout(timer.current);
    setVisible(true);
    timer.current=setTimeout(()=>setVisible(false),320);
    return()=>{if(timer.current)clearTimeout(timer.current)};
  },[pathname]);

  if(!visible)return null;
  return <View pointerEvents="none" style={s.overlay}><AppLoadingVisual/></View>;
}

const s=StyleSheet.create({
  overlay:{position:'absolute',top:0,right:0,bottom:0,left:0,zIndex:9999,elevation:9999,backgroundColor:PA.primary,alignItems:'center',justifyContent:'center'},
});
