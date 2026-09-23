import {useEffect} from 'react';
import {ActivityIndicator,StyleSheet,Text,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {PA} from '../constants/theme';

function first(v:string|string[]|undefined){return Array.isArray(v)?v[0]??'':v??''}
function enc(v:string){return encodeURIComponent(v)}
function searchUrl(params:Record<string,string|undefined>){
  const q=Object.entries(params).filter(([,v])=>Boolean(v)).map(([k,v])=>`${enc(k)}=${enc(v!)}`).join('&');
  return q?`/search?${q}`:'/search';
}
function webFeatureUrl(parts:string[],params:Record<string,string|string[]|undefined>){
  const query=Object.entries(params).filter(([k,v])=>k!=='path'&&Boolean(v)).map(([k,v])=>`${enc(k)}=${enc(first(v))}`).join('&');
  const path='/'+parts.map(enc).join('/')+(query?'?'+query:'');
  return `/web-feature?path=${enc(path)}`;
}

export default function WebLinkFallback(){
  const params=useLocalSearchParams() as Record<string,string|string[]|undefined>;
  useEffect(()=>{
    const raw=params.path;
    const parts=(Array.isArray(raw)?raw:raw?[raw]:[]).map(v=>decodeURIComponent(String(v))).filter(Boolean);
    const [a,b,c]=parts;
    let target='/';

    if(a==='assistance'){
      const ticket=first(params.ticket);
      target=ticket?`/support?ticket=${enc(ticket)}`:'/support';
    }
    else if(a==='connexion')target='/auth/login';
    else if(a==='inscription')target='/auth/register';
    else if(a==='mot-de-passe-oublie')target='/auth/forgot-password';
    else if(a==='reinitialiser-mot-de-passe'){
      const token=first(params.token);
      target=token?`/auth/reset-password?token=${enc(token)}`:'/auth/reset-password';
    }
    else if(a==='verifier-email'||a==='verifiez-votre-email'){
      const token=first(params.token);
      target=token?`/auth/verify-email?token=${enc(token)}`:'/auth/verify-email';
    }
    else if(a==='notifications')target='/activity-center';
    else if(a==='espace-pro'){
      if(b==='abonnement')target='/pro-subscription';
      else if(b==='statistiques'||b==='analytics')target='/pro-analytics';
      else if(b==='imports')target='/pro-imports';
      else if(b==='annonces')target='/pro-listings';
      else if(b==='visibilite')target='/pro-promotions';
      else if(b==='crm')target='/pro-crm';
      else if(b==='equipe')target='/pro-team';
      else if(b==='rendez-vous')target='/pro-appointments';
      else if(b==='boutiques'||b==='entreprise'||b==='compte')target='/pro-account';
      else if(b==='messages')target='/messages';
      else if(b==='ventes')target='/orders';
      else if(b==='reservations')target='/reservations';
      else if(b==='credits')target='/wallet';
      else target='/pro-account';
    }
    else if(a==='annonce'&&b)target=`/annonce/${enc(b)}`;
    else if(a==='messages'&&b)target=`/messages/${enc(b)}`;
    else if(a==='messages'){const conversation=first(params.conversation);target=conversation?`/messages/${enc(conversation)}`:'/(tabs)/messages';}
    else if(a==='parrainage')target='/referrals';
    else if(a==='deposer-une-annonce'||a==='deposer-annonce-gratuite')target='/sell';
    else if(a==='importer-une-annonce')target='/import-listing';
    else if(a==='boutique'&&b)target=`/store/${enc(b)}`;
    else if(a==='profil'&&b)target=`/seller/${enc(b)}`;
    else if(a==='commandes'&&b)target=`/orders/${enc(b)}`;
    else if(a==='commandes')target='/orders';
    else if(a==='mon-compte'){
      const map:Record<string,string>={
        portefeuille:'/wallet',annonces:'/my-listings',favoris:'/favorites',recherches:'/saved-searches',
        securite:'/security',profil:'/profile',adresses:'/addresses',notifications:'/activity-center',
        reputation:'/reputation',reservations:'/reservations',activite:'/activity-center',paiements:'/orders',
        parametres:'/privacy-account',suivis:'/favorites'
      };
      target=map[b??'']??'/account';
    }else if(a==='categorie'&&b)target=searchUrl({category:b});
    else if(a==='ville'&&b)target=searchUrl({city:b.replace(/-/g,' ')});
    else if(a==='c'&&b)target=searchUrl({category:b,city:c?.replace(/-/g,' ')});
    else if(a==='vehicules'&&b)target=searchUrl({category:'vehicules',q:[b,c].filter(Boolean).join(' ').replace(/-/g,' ')});
    else if(a==='occasion'&&b)target=searchUrl({q:b.replace(/-/g,' ')});
    else if(a==='vacances')target=searchUrl({category:'vacances',city:b?.replace(/-/g,' ')});
    else if(a==='recherche')target=searchUrl({q:first(params.q),category:first(params.category),city:first(params.city)});
    else if(a)target=webFeatureUrl(parts,params);

    router.replace(target as never);
  },[params]);

  return <View style={s.page}><ActivityIndicator color={PA.primary}/><Text style={s.text}>Ouverture dans Petit Annonces…</Text></View>;
}

const s=StyleSheet.create({page:{flex:1,alignItems:'center',justifyContent:'center',gap:12,backgroundColor:PA.bg},text:{fontSize:12,fontWeight:'800',color:PA.muted}});