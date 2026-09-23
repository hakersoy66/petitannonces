import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { PA } from '../../constants/theme';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AppIcon } from '../../components/app-icon';

function message(error: unknown) {
  const code = error instanceof ApiError ? error.code : '';
  if (code === 'invalid_credentials') return 'E-mail ou mot de passe incorrect.';
  if (code === 'account_temporarily_locked') return 'Compte temporairement verrouillé. Réessayez plus tard.';
  if (code === 'account_unavailable') return 'Ce compte n’est pas disponible pour le moment.';
  return 'Connexion impossible. Réessayez dans quelques instants.';
}

const benefits=[
  ['list','Gérez vos annonces','Modifiez, mettez en pause ou republiez vos annonces.'],
  ['comments','Centralisez vos échanges','Retrouvez messages, offres et conversations au même endroit.'],
  ['credit-card','Suivez achats et ventes','Gardez un œil sur commandes, paiements et livraisons.'],
  ['shield','Profitez d’un espace plus sûr','Profil, historique et outils de confiance vous accompagnent.'],
] as const;

export default function LoginScreen() {
  const params=useLocalSearchParams<{email?:string;reset?:string}>();
  const { login } = useAuth();
  const [email,setEmail]=useState(typeof params.email==='string'?params.email:'');
  const [password,setPassword]=useState('');
  const [remember,setRemember]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(typeof params.email==='string'&&params.email)setEmail(params.email)},[params.email]);
  async function submit(){
    if(!email.trim()||!password)return;
    setBusy(true);setError('');
    try{
      const result=await login(email.trim().toLowerCase(),password,remember);
      router.replace(result.authenticated?'/account':'/auth/two-factor');
    }catch(e){
      if(e instanceof ApiError&&e.code==='email_verification_required'){router.replace({pathname:'/auth/verify-pending',params:{email:email.trim().toLowerCase()}});return}
      if(e instanceof ApiError&&e.code==='password_reset_required'){router.push({pathname:'/auth/forgot-password',params:{email:email.trim().toLowerCase()}});return}
      setError(message(e));
    }finally{setBusy(false)}
  }
  return <SafeAreaView style={s.safe} edges={['top','bottom']}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS==='ios'?'padding':undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll} keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      <View style={s.brandBar}><Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={()=>router.back()} style={s.backButton}><AppIcon name="chevron-left" size={14} color={PA.ink}/></Pressable><Image source={require('../../../assets/images/site-mobile-logo.png')} style={s.logo} contentFit="contain"/><View style={s.backSpacer}/></View>
      <View style={s.formCard}>
        <Text style={s.eyebrow}>BIENVENUE</Text>
        <Text style={s.title}>Connectez-vous à Petit Annonces</Text>
        <Text style={s.lead}>Retrouvez vos annonces, vos messages, vos achats et vos ventes dans un espace personnel simple et sécurisé.</Text>
        {params.reset==='1'?<View style={s.successBox}><AppIcon name="circle-check" size={15} color="#18794e"/><Text style={s.successText}>Mot de passe modifié. Vous pouvez maintenant vous connecter.</Text></View>:null}
        {error?<View style={s.errorBox}><AppIcon name="triangle-exclamation" size={14} color="#9f1239"/><Text style={s.errorText}>{error}</Text></View>:null}
        <View style={s.switcher}><View style={[s.switchTab,s.switchActive]}><Text style={s.switchActiveText}>Connexion</Text></View><Pressable style={s.switchTab} onPress={()=>router.replace('/auth/register')}><Text style={s.switchText}>Créer un compte</Text></Pressable></View>
        <View style={s.form}>
          <View style={s.field}><Text style={s.label}>Adresse e-mail</Text><TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="vous@exemple.fr" placeholderTextColor="#9b97aa" style={s.input}/></View>
          <View style={s.field}><Text style={s.label}>Mot de passe</Text><TextInput autoCapitalize="none" autoComplete="current-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Votre mot de passe" placeholderTextColor="#9b97aa" style={s.input}/></View>
          <View style={s.loginOptions}><Pressable style={s.rememberRow} onPress={()=>setRemember(v=>!v)}><Switch value={remember} onValueChange={setRemember} trackColor={{false:'#dedbe8',true:'#cfc8ff'}} thumbColor={remember?PA.primary:'#fff'}/><Text style={s.rememberText}>Rester connecté</Text></Pressable><Pressable onPress={()=>router.push({pathname:'/auth/forgot-password',params:{email:email.trim()}})}><Text style={s.inlineLink}>Mot de passe oublié ?</Text></Pressable></View>
          <Pressable disabled={busy||!email.trim()||!password} onPress={()=>void submit()} style={[s.primary,busy&&s.disabled]}>{busy?<ActivityIndicator color="#fff"/>:<><Text style={s.primaryText}>Se connecter</Text><AppIcon name="arrow-right" size={14} color="#fff"/></>}</Pressable>
        </View>
        <View style={s.divider}><View style={s.dividerLine}/><Text style={s.dividerText}>ou</Text><View style={s.dividerLine}/></View>
        <Text style={s.footText}>Pas encore de compte ? <Text style={s.inlineLink} onPress={()=>router.replace('/auth/register')}>Inscrivez-vous gratuitement</Text></Text>
      </View>
      <View style={s.benefitCard}>
        <View style={s.benefitGlow}/><Text style={s.benefitEyebrow}>VOTRE ESPACE PERSONNEL</Text><Text style={s.benefitTitle}>Tout ce qui compte, au même endroit.</Text><Text style={s.benefitLead}>Connectez-vous pour gagner du temps, répondre plus vite et garder une vue claire sur toute votre activité.</Text>
        <View style={s.benefits}>{benefits.map(([icon,title,text])=><View style={s.benefit} key={title}><View style={s.benefitIcon}><AppIcon name={icon} size={17} color="#fff"/></View><View style={{flex:1}}><Text style={s.benefitRowTitle}>{title}</Text><Text style={s.benefitRowText}>{text}</Text></View></View>)}</View>
      </View>
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:'#f7f7fc'},flex:{flex:1},scroll:{padding:14,paddingBottom:34,gap:14},brandBar:{height:54,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},backButton:{width:38,height:38,borderRadius:13,backgroundColor:'#fff',borderWidth:1,borderColor:'#e6e3ee',alignItems:'center',justifyContent:'center'},backSpacer:{width:38},logo:{width:150,height:30},
  formCard:{backgroundColor:'#fff',borderWidth:1,borderColor:'#e7e5ef',borderRadius:24,padding:22,shadowColor:'#2a235a',shadowOpacity:.07,shadowRadius:22,shadowOffset:{width:0,height:10}},eyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.25,color:'#6253ea',marginBottom:10},title:{fontSize:30,lineHeight:32,fontWeight:'900',letterSpacing:-.9,color:'#17152b'},lead:{fontSize:13,lineHeight:20,color:'#69657a',marginTop:10,marginBottom:18},
  switcher:{height:48,flexDirection:'row',backgroundColor:'#f4f3f8',padding:5,borderRadius:12,marginBottom:18},switchTab:{flex:1,borderRadius:9,alignItems:'center',justifyContent:'center'},switchActive:{backgroundColor:'#fff',shadowColor:'#14103c',shadowOpacity:.07,shadowRadius:8,shadowOffset:{width:0,height:3}},switchText:{fontSize:12,fontWeight:'800',color:'#6e697c'},switchActiveText:{fontSize:12,fontWeight:'900',color:'#4d3fe1'},form:{gap:15},field:{gap:7},label:{fontSize:12,fontWeight:'800',color:'#363249'},input:{height:52,borderWidth:1,borderColor:'#dcd9e8',backgroundColor:'#fff',borderRadius:13,paddingHorizontal:15,fontSize:16,color:'#1a1730'},loginOptions:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'},rememberRow:{flexDirection:'row',alignItems:'center',gap:7},rememberText:{fontSize:12,color:'#686477',fontWeight:'700'},inlineLink:{color:'#5848e8',fontWeight:'900',fontSize:12},primary:{minHeight:52,borderRadius:13,backgroundColor:PA.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,shadowColor:PA.primary,shadowOpacity:.22,shadowRadius:13,shadowOffset:{width:0,height:7}},primaryText:{color:'#fff',fontWeight:'900',fontSize:15},disabled:{opacity:.55},divider:{flexDirection:'row',alignItems:'center',gap:10,marginVertical:17},dividerLine:{flex:1,height:1,backgroundColor:'#eceaf2'},dividerText:{fontSize:11,color:'#9b97aa'},footText:{textAlign:'center',fontSize:13,color:'#6d687b'},
  errorBox:{borderRadius:12,padding:12,backgroundColor:'#fff1f2',borderWidth:1,borderColor:'#fecdd3',flexDirection:'row',gap:8,alignItems:'flex-start',marginBottom:14},errorText:{flex:1,color:'#9f1239',fontSize:12,lineHeight:18},successBox:{borderRadius:12,padding:12,backgroundColor:'#ecfdf3',borderWidth:1,borderColor:'#bbf7d0',flexDirection:'row',gap:8,alignItems:'flex-start',marginBottom:14},successText:{flex:1,color:'#166534',fontSize:12,lineHeight:18,fontWeight:'700'},
  benefitCard:{position:'relative',overflow:'hidden',backgroundColor:'#5140dc',borderRadius:24,padding:22,shadowColor:'#2a235a',shadowOpacity:.16,shadowRadius:24,shadowOffset:{width:0,height:12}},benefitGlow:{position:'absolute',width:220,height:220,borderRadius:110,backgroundColor:'rgba(255,255,255,.08)',right:-80,bottom:-95},benefitEyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.1,color:'#dcd7ff'},benefitTitle:{fontSize:27,lineHeight:29,fontWeight:'900',letterSpacing:-.8,color:'#fff',marginTop:11},benefitLead:{fontSize:12.5,lineHeight:19,color:'#e7e3ff',marginTop:9},benefits:{gap:10,marginTop:20},benefit:{flexDirection:'row',gap:11,alignItems:'flex-start',padding:13,borderWidth:1,borderColor:'rgba(255,255,255,.15)',backgroundColor:'rgba(255,255,255,.085)',borderRadius:15},benefitIcon:{width:40,height:40,borderRadius:12,backgroundColor:'rgba(255,255,255,.14)',alignItems:'center',justifyContent:'center'},benefitRowTitle:{fontSize:12.5,fontWeight:'900',color:'#fff'},benefitRowText:{fontSize:11,lineHeight:16,color:'#e5e1ff',marginTop:3},
});