import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, apiRequest, subscribeUnauthorized } from './api';

const TOKEN_KEY = 'pa.native.session.v1';
const USER_KEY = 'pa.native.user.v1';

export type NativeUser = {
  id: string;
  email: string;
  kind: 'PARTICULIER' | 'PROFESSIONNEL';
  profile?: { displayName?: string | null; firstName?: string | null; avatarUrl?: string | null } | null;
  roles?: string[];
};

type LoginResult = { authenticated: true } | { authenticated: false; twoFactorRequired: true };
type RegisterResult = { authenticated: boolean; verificationRequired: boolean };

type AuthValue = {
  user: NativeUser | null;
  token: string | null;
  loading: boolean;
  pendingTwoFactor: boolean;
  login(email: string, password: string, remember?: boolean): Promise<LoginResult>;
  completeTwoFactor(code: string): Promise<void>;
  register(input: { email: string; password: string; displayName: string; kind: 'PARTICULIER' | 'PROFESSIONNEL' }): Promise<RegisterResult>;
  verifyEmail(verificationToken: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

type SessionPayload = { authenticated: true; sessionToken: string; expiresAt?: string; user?: NativeUser };
type LoginPayload = SessionPayload | { authenticated: false; twoFactorRequired: true; challengeToken: string; remember: boolean; expiresInSeconds: number };

async function readCachedUser(): Promise<NativeUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NativeUser;
    return parsed && typeof parsed.id === 'string' && typeof parsed.email === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCachedUser(nextUser: NativeUser) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<NativeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [challenge, setChallenge] = useState<{ token: string; remember: boolean } | null>(null);

  const persistSession = useCallback(async (sessionToken: string, nextUser?: NativeUser) => {
    await SecureStore.setItemAsync(TOKEN_KEY, sessionToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    setToken(sessionToken);
    if (nextUser) {
      setUser(nextUser);
      await writeCachedUser(nextUser).catch(() => undefined);
      return;
    }
    const me = await apiRequest<{ user: NativeUser }>('/auth/mobile/me', { token: sessionToken });
    setUser(me.user);
    await writeCachedUser(me.user).catch(() => undefined);
  }, []);

  const clearSession = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined),
      SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined),
    ]);
    setToken(null);
    setUser(null);
    setChallenge(null);
  }, []);

  const refresh = useCallback(async () => {
    const saved = token ?? await SecureStore.getItemAsync(TOKEN_KEY);
    if (!saved) {
      setUser(null);
      setToken(null);
      return;
    }
    setToken(saved);
    try {
      const me = await apiRequest<{ user: NativeUser }>('/auth/mobile/me', { token: saved });
      setUser(me.user);
      await writeCachedUser(me.user).catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearSession();
      else throw error;
    }
  }, [token, clearSession]);

  const bootstrap = useCallback(async () => {
    const [saved, cachedUser] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      readCachedUser(),
    ]);
    if (!saved) {
      setUser(null);
      setToken(null);
      return;
    }

    setToken(saved);
    if (cachedUser) setUser(cachedUser);

    try {
      const me = await apiRequest<{ user: NativeUser }>('/auth/mobile/me', { token: saved });
      setUser(me.user);
      await writeCachedUser(me.user).catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearSession();
      else if (!cachedUser) setUser(null);
    }
  }, [clearSession]);

  useEffect(() => {
    let active = true;
    bootstrap().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bootstrap]);

  useEffect(() => subscribeUnauthorized(() => { void clearSession(); }), [clearSession]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh().catch(() => undefined);
    });
    return () => sub.remove();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, remember = true): Promise<LoginResult> => {
    const result = await apiRequest<LoginPayload>('/auth/mobile/login', { method: 'POST', body: { email, password, remember } });
    if (!result.authenticated) {
      setChallenge({ token: result.challengeToken, remember: result.remember });
      return { authenticated: false, twoFactorRequired: true };
    }
    await persistSession(result.sessionToken, result.user);
    setChallenge(null);
    return { authenticated: true };
  }, [persistSession]);

  const completeTwoFactor = useCallback(async (code: string) => {
    if (!challenge) throw new Error('two_factor_challenge_missing');
    const result = await apiRequest<SessionPayload>('/auth/mobile/2fa/complete', { method: 'POST', body: { challengeToken: challenge.token, code, remember: challenge.remember } });
    await persistSession(result.sessionToken, result.user);
    setChallenge(null);
  }, [challenge, persistSession]);

  const register = useCallback(async (input: { email: string; password: string; displayName: string; kind: 'PARTICULIER' | 'PROFESSIONNEL' }): Promise<RegisterResult> => {
    const result = await apiRequest<{ authenticated: boolean; verificationRequired: boolean; sessionToken?: string; user?: NativeUser }>('/auth/mobile/register', { method: 'POST', body: { ...input, onboardingWizard: true } });
    if (result.authenticated && result.sessionToken) await persistSession(result.sessionToken, result.user);
    return { authenticated: result.authenticated, verificationRequired: result.verificationRequired };
  }, [persistSession]);

  const verifyEmail = useCallback(async (verificationToken: string) => {
    const result = await apiRequest<SessionPayload & { verified: true }>('/auth/mobile/verify-email', { method: 'POST', body: { token: verificationToken } });
    await persistSession(result.sessionToken, result.user);
  }, [persistSession]);

  const logout = useCallback(async () => {
    if (token) await apiRequest('/auth/mobile/logout', { method: 'POST', token }).catch(() => undefined);
    await clearSession();
  }, [token, clearSession]);

  const value = useMemo<AuthValue>(() => ({ user, token, loading, pendingTwoFactor: Boolean(challenge), login, completeTwoFactor, register, verifyEmail, logout, refresh }), [user, token, loading, challenge, login, completeTwoFactor, register, verifyEmail, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}

[executed on device: mail.petitannonces.fr (b9fdfe5f-3df4-4e4a-a34e-5aa72c2ab64d)]