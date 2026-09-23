import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PA } from '../constants/theme';
import { AppIcon } from './app-icon';

const steps=[
  {label:'Catégorie',icon:'list' as const},
  {label:'Photos',icon:'camera' as const},
  {label:'Détails',icon:'sliders' as const},
  {label:'Prix',icon:'euro-sign' as const},
  {label:'Publication',icon:'shield-halved' as const},
];

export function ListingWizardStepper({current}:{current:number}){
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.track} style={s.wrap}>
    {steps.map((step,index)=>{const done=index<current;const active=index===current;return <View key={step.label} style={[s.item,active&&s.active,done&&s.done]}>
      <View style={[s.number,active&&s.numberActive,done&&s.numberDone]}>{done?<AppIcon name="check" size={11} color="#167654"/>:<AppIcon name={step.icon} size={12} color={active?'#fff':'#858491'}/>}</View>
      <View><Text style={[s.kicker,active&&s.kickerActive,done&&s.kickerDone]}>Étape {index+1}</Text><Text style={[s.label,active&&s.labelActive,done&&s.labelDone]}>{step.label}</Text></View>
    </View>})}
  </ScrollView>
}
const s=StyleSheet.create({wrap:{marginBottom:14},track:{paddingHorizontal:15,gap:7},item:{minWidth:102,minHeight:54,paddingHorizontal:10,paddingVertical:7,borderRadius:13,backgroundColor:'#fff',borderWidth:1,borderColor:'#e6e4ee',flexDirection:'row',alignItems:'center',gap:8},active:{minWidth:132,backgroundColor:'#f6f3ff',borderColor:'#ded9ff'},done:{borderColor:'#d5ebdf',backgroundColor:'#f7fcf9'},number:{width:30,height:30,borderRadius:15,backgroundColor:'#f2f2f6',alignItems:'center',justifyContent:'center'},numberActive:{backgroundColor:PA.primary},numberDone:{backgroundColor:'#eaf8f1',borderWidth:1,borderColor:'#bfe4d2'},kicker:{fontSize:8,fontWeight:'900',letterSpacing:.6,textTransform:'uppercase',color:'#aaa8b3'},kickerActive:{color:'#7468dc'},kickerDone:{color:'#63a78d'},label:{fontSize:10.5,fontWeight:'800',color:'#858491',marginTop:1},labelActive:{fontSize:11.5,color:'#4236bc'},labelDone:{color:'#167654'}});