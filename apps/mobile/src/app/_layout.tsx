import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AuthProvider} from '../lib/auth';
import {PushProvider} from '../lib/push';
import {MobileUiProvider} from '../lib/mobile-ui';
import {ConnectivityProvider} from '../lib/connectivity';
import {AppErrorBoundary} from '../components/app-error-boundary';

function NativeAppStack(){
  return <View style={{flex:1,minWidth:0,overflow:'hidden',backgroundColor:'#fff'}}>
    <Stack unstable_screenErrorBoundary={AppErrorBoundary} screenOptions={{headerShown:false,contentStyle:{backgroundColor:'#fff'}}}>
      <Stack.Screen name="(tabs)"/>
      <Stack.Screen name="web-feature"/>
      <Stack.Screen name="[...path]"/>
      <Stack.Screen name="annonce/[slug]"/>
      <Stack.Screen name="favorites"/>
      <Stack.Screen name="my-listings"/>
      <Stack.Screen name="reservations"/>
      <Stack.Screen name="reservation-change/[id]"/>
      <Stack.Screen name="vacation-host"/>
      <Stack.Screen name="vacation-manage/[id]"/>
      <Stack.Screen name="orders"/>
      <Stack.Screen name="orders/[id]"/>
      <Stack.Screen name="checkout/[id]"/>
      <Stack.Screen name="privacy-account"/>
      <Stack.Screen name="security"/>
      <Stack.Screen name="wallet"/>
      <Stack.Screen name="reputation"/>
      <Stack.Screen name="profile"/>
      <Stack.Screen name="addresses"/>
      <Stack.Screen name="notification-settings"/>
      <Stack.Screen name="activity-center"/>
      <Stack.Screen name="pro-account"/>
      <Stack.Screen name="pro-analytics"/>
      <Stack.Screen name="pro-imports"/>
      <Stack.Screen name="pro-listings"/>
      <Stack.Screen name="pro-promotions"/>
      <Stack.Screen name="pro-crm"/>
      <Stack.Screen name="pro-team"/>
      <Stack.Screen name="pro-appointments"/>
      <Stack.Screen name="pro-subscription"/>
      <Stack.Screen name="pro-store/[id]"/>
      <Stack.Screen name="seller/[id]"/>
      <Stack.Screen name="store/[slug]"/>
      <Stack.Screen name="saved-searches"/>
      <Stack.Screen name="referrals"/>
      <Stack.Screen name="support"/>
      <Stack.Screen name="import-listing"/>
      <Stack.Screen name="vacation-book/[id]"/>
      <Stack.Screen name="messages/[id]"/>
      <Stack.Screen name="publish/[id]"/>
      <Stack.Screen name="auth/login"/>
      <Stack.Screen name="auth/register"/>
      <Stack.Screen name="auth/two-factor"/>
      <Stack.Screen name="auth/forgot-password"/>
      <Stack.Screen name="auth/verify-pending"/>
      <Stack.Screen name="auth/verify-email"/>
      <Stack.Screen name="auth/reset-password"/>
    </Stack>
  </View>;
}

export {AppErrorBoundary as ErrorBoundary};

export default function RootLayout(){
  return <SafeAreaProvider>
    <ConnectivityProvider>
      <MobileUiProvider>
        <AuthProvider>
          <PushProvider>
            <StatusBar style="dark"/>
            <NativeAppStack/>
          </PushProvider>
        </AuthProvider>
      </MobileUiProvider>
    </ConnectivityProvider>
  </SafeAreaProvider>;
}
