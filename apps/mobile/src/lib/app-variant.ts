import Constants from 'expo-constants';

export type AppVariant='development'|'preview'|'production';
export type NativeScheme='petitannonces-development'|'petitannonces-preview'|'petitannonces';

export function appVariant():AppVariant{
  const raw=String(Constants.expoConfig?.extra?.appVariant??'production').toLowerCase();
  return raw==='development'||raw==='preview'?raw:'production';
}

export function nativeScheme():NativeScheme{
  const v=appVariant();
  return v==='development'?'petitannonces-development':v==='preview'?'petitannonces-preview':'petitannonces';
}