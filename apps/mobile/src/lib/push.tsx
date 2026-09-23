import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { AppState, InteractionManager, Platform } from 'react-native';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from './api';
import { useAuth } from './auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

type PushPermission = 'granted' | 'denied' | 'undetermined';
type PushValue = {
  permission: PushPermission;
  subscribed: boolean;
  busy: boolean;
  projectReady: boolean;
  error: string | null;
  badgeCount: number;
  enablePush(): Promise<boolean>;
  disablePush(): Promise<boolean>;
  syncBadge(): Promise<number>;
};

const PushContext = createContext<PushValue | null>(null);

function expoProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId ?? null;
}

function permissionOf(status: string): PushPermission {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

function pwaShellRoute(path: string) {
  const safe = path.startsWith('/') ? path : '/';
  return `/web-feature?path=${encodeURIComponent(safe)}`;
}

function nativeRouteFromWebUrl(url:URL){
  const path=url.pathname.replace(/\/{2,}/g,'/');
  const parts=path.split('/').filter(Boolean);
  const [a,b]=parts;
  if(a==='messages'){
    const conversation=url.searchParams.get('conversation')||b||'';
    return conversation?`/messages/${encodeURIComponent(conversation)}`:'/(tabs)/messages';
  }
  if(a==='commandes')return b?`/orders/${encodeURIComponent(b)}`:'/orders';
  if(a==='annonce'&&b)return `/annonce/${encodeURIComponent(b)}`;
  if(a==='profil'&&b)return `/seller/${encodeURIComponent(b)}`;
  if(a==='boutique'&&b)return `/store/${encodeURIComponent(b)}`;
  if(a==='mon-compte'&&b==='notifications')return '/activity-center';
  if(a==='mon-compte'&&b==='paiements')return '/orders';
  if(a==='notifications')return '/activity-center';
  if(a==='assistance'){
    const ticket=url.searchParams.get('ticket');
    return ticket?`/support?ticket=${encodeURIComponent(ticket)}`:'/support';
  }
  return null;
}

export function appRouteFromNotification(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return pwaShellRoute('/');
  try {
    const value=raw.trim();
    const relative=value.startsWith('/');
    const url=relative?new URL(value,'https://petitannonces.fr'):new URL(value);
    const isWeb=relative||['petitannonces.fr','www.petitannonces.fr'].includes(url.hostname);
    if(isWeb)return nativeRouteFromWebUrl(url)??pwaShellRoute(`${url.pathname||'/'}${url.search}${url.hash}`);
    if(url.protocol==='petitannonces:'){
      const pathname=`/${[url.hostname,url.pathname.replace(/^\/+/, '')].filter(Boolean).join('/')}`.replace(/\/{2,}/g,'/');
      const internal=new URL(`${pathname||'/'}${url.search}${url.hash}`,'https://petitannonces.fr');
      return nativeRouteFromWebUrl(internal)??pwaShellRoute(`${internal.pathname}${internal.search}${internal.hash}`);
    }
    return pwaShellRoute('/');
  } catch {
    return pwaShellRoute('/');
  }
}

export function appRouteFromNotificationData(data: Record<string, unknown>): string {
  const fromUrl=typeof data.url==='string'&&data.url.trim()?appRouteFromNotification(data.url):null;
  if(fromUrl)return fromUrl;

  let metadata:Record<string,unknown>={};
  if(data.metadata&&typeof data.metadata==='object') metadata=data.metadata as Record<string,unknown>;
  else if(typeof data.metadata==='string'){
    try{const parsed=JSON.parse(data.metadata);if(parsed&&typeof parsed==='object')metadata=parsed as Record<string,unknown>;}catch{}
  }
  const combined={...metadata,...data};
  const text=(key:string)=>typeof combined[key]==='string'?String(combined[key]).trim():'';
  const conversationId=text('conversationId')||text('conversation_id');
  if(conversationId)return pwaShellRoute(`/messages?conversation=${encodeURIComponent(conversationId)}`);
  const listingSlug=text('listingSlug')||text('listing_slug')||text('slug');
  if(listingSlug)return pwaShellRoute(`/annonce/${encodeURIComponent(listingSlug)}`);
  const orderId=text('orderId')||text('order_id');
  if(orderId)return pwaShellRoute(`/commandes/${encodeURIComponent(orderId)}`);
  const sellerId=text('sellerId')||text('seller_id');
  if(sellerId)return pwaShellRoute(`/profil/${encodeURIComponent(sellerId)}`);
  const storeSlug=text('storeSlug')||text('store_slug');
  if(storeSlug)return pwaShellRoute(`/boutique/${encodeURIComponent(storeSlug)}`);
  const supportTicketId=text('supportTicketId')||text('support_ticket_id')||text('ticketId');
  if(supportTicketId)return pwaShellRoute(`/assistance?ticket=${encodeURIComponent(supportTicketId)}`);
  const route=text('route')||text('path')||text('actionUrl')||text('action_url');
  return route?appRouteFromNotification(route):pwaShellRoute('/');
}

const ANDROID_GENERAL_CHANNEL = 'pa-general-v3';
const ANDROID_MESSAGES_CHANNEL = 'pa-messages-v3';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const common = {
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 180, 120, 180],
    sound: 'default' as const,
    enableVibrate: true,
    showBadge: true,
  };
  await Promise.all([
    Notifications.setNotificationChannelAsync('default', { ...common, name: 'Petit Annonces', description: 'Notifications Petit Annonces.' }),
    Notifications.setNotificationChannelAsync(ANDROID_GENERAL_CHANNEL, { ...common, name: 'Petit Annonces · Général', description: 'Activité, offres et informations Petit Annonces.' }),
    Notifications.setNotificationChannelAsync(ANDROID_MESSAGES_CHANNEL, { ...common, name: 'Petit Annonces · Messages', description: 'Nouveaux messages et conversations.' }),
  ]);
}

function nativeDeviceLabel() {
  const device = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || Platform.OS;
  const transport = Platform.OS === 'ios' ? 'pa-expo-apns-v1' : 'pa-expo-fcm-v1 · pa-channels-v3';
  return `${device} · ${transport}`.slice(0, 120);
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [permission, setPermission] = useState<PushPermission>('undetermined');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const handledResponse = useRef<string | null>(null);
  const pendingNavigation = useRef<string | null>(null);
  const rootNavigationState = useRootNavigationState();
  const projectReady = Boolean(expoProjectId());

  const syncBadge = useCallback(async () => {
    if (!token) {
      setBadgeCount(0);
      await Notifications.setBadgeCountAsync(0).catch(() => false);
      return 0;
    }
    try {
      const summary = await apiRequest<{ unreadNotifications: number }>('/account/message-summary', { token });
      const count = Math.max(0, Number(summary.unreadNotifications ?? 0));
      setBadgeCount(count);
      await Notifications.setBadgeCountAsync(count).catch(() => false);
      return count;
    } catch {
      return 0;
    }
  }, [token]);

  const reportDiagnostic = useCallback(async (stage: 'permission'|'native_token'|'expo_token'|'subscribe'|'token_refresh'|'received'|'opened', cause: unknown) => {
    if (!token) return;
    const raw = cause instanceof Error ? cause.message : String(cause ?? 'unknown_error');
    const code = raw.replace(/Expo(?:nent)?PushToken\[[^\]]+\]/g, '[token]').replace(/[A-Za-z0-9_-]{96,}/g, '[redacted]').slice(0, 160) || 'unknown_error';
    await apiRequest('/notifications/push/diagnostic', {
      method: 'POST', token,
      body: { platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID', stage, code, appVersion: Constants.expoConfig?.version ?? 'unknown' },
    }).catch(() => undefined);
  }, [token]);

  const subscribeWithPermission = useCallback(async () => {
    if (!token || !user) return false;
    const projectId = expoProjectId();
    if (!projectId) {
      setError('eas_project_missing');
      await reportDiagnostic('expo_token', 'eas_project_missing');
      return false;
    }
    await ensureAndroidChannel();
    let devicePushToken: Notifications.DevicePushToken;
    try {
      devicePushToken = await Notifications.getDevicePushTokenAsync();
    } catch (cause) {
      setSubscribed(false);
      setError(`native_token:${cause instanceof Error ? cause.message : 'failed'}`);
      await reportDiagnostic('native_token', cause);
      return false;
    }
    let subscriptionToken: string;
    try {
      const expo = await Notifications.getExpoPushTokenAsync({ projectId: String(projectId), devicePushToken });
      subscriptionToken = expo.data.trim();
      if (!subscriptionToken) throw new Error('empty_expo_push_token');
    } catch (cause) {
      setSubscribed(false);
      setError(`expo_token:${cause instanceof Error ? cause.message : 'failed'}`);
      await reportDiagnostic('expo_token', cause);
      return false;
    }
    try {
      await apiRequest('/notifications/push/subscribe', {
        method: 'POST',
        token,
        body: {
          platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
          nativeToken: subscriptionToken,
          deviceLabel: nativeDeviceLabel(),
        },
      });
      setSubscribed(true);
      setError(null);
      await syncBadge();
      return true;
    } catch (cause) {
      setSubscribed(false);
      setError(`subscribe:${cause instanceof Error ? cause.message : 'failed'}`);
      await reportDiagnostic('subscribe', cause);
      return false;
    }
  }, [token, user, syncBadge, reportDiagnostic]);

  const enablePush = useCallback(async () => {
    if (!token) return false;
    setBusy(true);
    setError(null);
    try {
      await ensureAndroidChannel();
      let current = await Notifications.getPermissionsAsync();
      if (current.status !== 'granted') {
        current = Platform.OS === 'ios'
          ? await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })
          : await Notifications.requestPermissionsAsync();
      }
      const next = permissionOf(current.status);
      setPermission(next);
      if (next !== 'granted') {
        setSubscribed(false);
        setError('permission_denied');
        await reportDiagnostic('permission', next);
        return false;
      }
      const ok = await subscribeWithPermission();
      if (ok) {
        await apiRequest('/notifications/push/test', { method:'POST', token }).catch(() => undefined);
        await syncBadge();
      }
      return ok;
    } finally {
      setBusy(false);
    }
  }, [token, subscribeWithPermission, reportDiagnostic, syncBadge]);

  const disablePush = useCallback(async () => {
    if (!token) return false;
    setBusy(true);
    setError(null);
    try {
      const projectId = expoProjectId();
      let nativeToken: string | null = null;
      if (projectId) {
        try {
          const devicePushToken = await Notifications.getDevicePushTokenAsync();
          nativeToken = (await Notifications.getExpoPushTokenAsync({ projectId: String(projectId), devicePushToken })).data.trim() || null;
        } catch {}
      }
      if (nativeToken) await apiRequest('/notifications/push/unsubscribe', { method:'POST', token, body:{ nativeToken } });
      setSubscribed(false);
      return true;
    } catch (cause) {
      setError('unsubscribe:' + (cause instanceof Error ? cause.message : 'failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [token]);

  const handleResponse = useCallback(async (response: Notifications.NotificationResponse | null | undefined) => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const requestId = response.notification.request.identifier;
    if (handledResponse.current === requestId) return;
    handledResponse.current = requestId;
    void reportDiagnostic('opened', 'notification_opened');
    const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
    const target = appRouteFromNotificationData(data);

    // Cold-start notification responses can arrive before Expo Router has mounted.
    if(rootNavigationState?.key){
      InteractionManager.runAfterInteractions(()=>router.push(target as never));
    }else{
      pendingNavigation.current=target;
    }
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);

    const notificationId = typeof data.notificationId === 'string' ? data.notificationId : null;
    if (token && notificationId) {
      void (async () => {
        try {
          const result = await apiRequest<{ unread: number }>(`/account/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST', token });
          const nextUnread = Math.max(0, Number(result.unread ?? 0));
          setBadgeCount(nextUnread);
          await Notifications.setBadgeCountAsync(nextUnread).catch(() => false);
        } catch {
          await syncBadge();
        }
      })();
    }
  }, [token, syncBadge, reportDiagnostic, rootNavigationState?.key]);

  useEffect(() => {
    if(!rootNavigationState?.key||!pendingNavigation.current)return;
    const target=pendingNavigation.current;
    pendingNavigation.current=null;
    const task=InteractionManager.runAfterInteractions(()=>router.push(target as never));
    return()=>task.cancel();
  },[rootNavigationState?.key]);

  useEffect(() => {
    void ensureAndroidChannel();
    void Notifications.getPermissionsAsync().then(async result => {
      const next = permissionOf(result.status);
      setPermission(next);
      if (!token || !user) return;
      if (next === 'granted') {
        await subscribeWithPermission();
        return;
      }
      if (next === 'undetermined') {
        await enablePush();
        return;
      }
      setSubscribed(false);
      setError('permission_denied');
    });
  }, [token, user, subscribeWithPermission, enablePush]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(notification => {
      void reportDiagnostic('received', 'notification_received');
      const raw = Number(notification.request.content.data?.badgeCount);
      if (Number.isFinite(raw) && raw >= 0) {
        const next = Math.floor(raw);
        setBadgeCount(next);
        void Notifications.setBadgeCountAsync(next);
      } else {
        void syncBadge();
      }
    });
    const responses = Notifications.addNotificationResponseReceivedListener(response => void handleResponse(response));
    const refresh = Notifications.addPushTokenListener(async devicePushToken => {
      if (!token || !user) return;
      const projectId = expoProjectId();
      if (!projectId) return;
      try {
        const subscriptionToken = (await Notifications.getExpoPushTokenAsync({ projectId: String(projectId), devicePushToken })).data.trim();
        if (!subscriptionToken) throw new Error('empty_push_token');
        await apiRequest('/notifications/push/subscribe', { method:'POST', token, body:{ platform:Platform.OS==='ios'?'IOS':'ANDROID', nativeToken:subscriptionToken, deviceLabel:nativeDeviceLabel() } });
        setSubscribed(true); setError(null);
      } catch (cause) { await reportDiagnostic('token_refresh', cause); }
    });
    void Notifications.getLastNotificationResponseAsync().then(response => void handleResponse(response));
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      void syncBadge();
      void Notifications.getPermissionsAsync().then(async result => {
        const next = permissionOf(result.status);
        setPermission(next);
        if (next === 'granted') {
          setError(null);
          if (!subscribed && token && user) await subscribeWithPermission();
          return;
        }
        if (next === 'denied') {
          setSubscribed(false);
          setError('permission_denied');
        }
      });
    });
    return () => { received.remove(); responses.remove(); refresh.remove(); appState.remove(); };
  }, [handleResponse, syncBadge, token, user, permission, subscribed, subscribeWithPermission, reportDiagnostic]);

  useEffect(() => {
    if (!token || !user) return;
    const tick = () => void syncBadge();
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [token, user, syncBadge]);

  useEffect(() => {
    if (!token) {
      setSubscribed(false);
      setBadgeCount(0);
      void Notifications.setBadgeCountAsync(0);
    }
  }, [token]);

  const value = useMemo<PushValue>(() => ({ permission, subscribed, busy, projectReady, error, badgeCount, enablePush, disablePush, syncBadge }), [permission, subscribed, busy, projectReady, error, badgeCount, enablePush, disablePush, syncBadge]);
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush() {
  const value = useContext(PushContext);
  if (!value) throw new Error('PushProvider missing');
  return value;
}