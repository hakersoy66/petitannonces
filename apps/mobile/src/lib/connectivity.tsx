import { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppIcon } from '../components/app-icon';
import { ConnectivityState, getConnectivityState, probeConnectivity, subscribeConnectivity } from './api';

type ConnectivityValue = {
  state: ConnectivityState;
  retry(): Promise<boolean>;
};

const ConnectivityContext = createContext<ConnectivityValue>({
  state: 'unknown',
  retry: () => probeConnectivity(),
});

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectivityState>(getConnectivityState());
  const activeRef = useRef(AppState.currentState === 'active');

  useEffect(() => {
    const unsubscribe = subscribeConnectivity(setState);
    void probeConnectivity();
    const appState = AppState.addEventListener('change', next => {
      activeRef.current = next === 'active';
      if (next === 'active') void probeConnectivity();
    });
    const timer = setInterval(() => {
      if (activeRef.current) void probeConnectivity();
    }, 30000);
    return () => {
      unsubscribe();
      appState.remove();
      clearInterval(timer);
    };
  }, []);

  return <ConnectivityContext.Provider value={{ state, retry: () => probeConnectivity() }}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  return useContext(ConnectivityContext);
}

export function ConnectivityBanner() {
  const { state, retry } = useConnectivity();
  const insets = useSafeAreaInsets();
  const previous = useRef<ConnectivityState>(state);
  const [restored, setRestored] = useState(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previous.current === 'offline' && state === 'online') {
      setRestored(true);
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      restoreTimer.current = setTimeout(() => setRestored(false), 2600);
    }
    previous.current = state;
    return () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, [state]);

  if (state !== 'offline' && !restored) return null;
  const offline = state === 'offline';
  return (
    <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 6 }]}>
      <Pressable
        disabled={!offline}
        onPress={() => void retry()}
        accessibilityRole="button"
        accessibilityLabel={offline ? 'Réessayer la connexion' : 'Connexion rétablie'}
        style={[s.banner, offline ? s.offline : s.online]}
      >
        <AppIcon name={offline ? 'wifi' : 'circle-check'} size={13} color={offline ? '#7a4c00' : '#087a55'} />
        <Text style={[s.text, offline ? s.offlineText : s.onlineText]}>{offline ? 'Connexion interrompue · Réessayer' : 'Connexion rétablie'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 999, alignItems: 'center' },
  banner: { minHeight: 38, maxWidth: 380, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  offline: { backgroundColor: '#fff8e6', borderColor: '#f0d395' },
  online: { backgroundColor: '#ecfdf5', borderColor: '#c8eadb' },
  text: { fontSize: 11, fontWeight: '900' },
  offlineText: { color: '#7a4c00' },
  onlineText: { color: '#087a55' },
});