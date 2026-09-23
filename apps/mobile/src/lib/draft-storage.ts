import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const LOCAL_PREFIX = 'pa.local-draft.v1';
const SECURE_PREFIX = 'pa.secure-draft.v1';
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Envelope<T> = {
  version: 1;
  savedAt: number;
  data: T;
};

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export function localDraftKey(scope: string, userId: string, entityId = 'new') {
  return `${LOCAL_PREFIX}.${safePart(scope)}.${safePart(userId)}.${safePart(entityId)}`;
}

export function secureDraftKey(scope: string, userId: string, entityId = 'new') {
  return `${SECURE_PREFIX}.${safePart(scope)}.${safePart(userId)}.${safePart(entityId)}`;
}

function decodeEnvelope<T>(raw: string | null, ttlMs: number): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (parsed.version !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > ttlMs) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export async function readLocalDraft<T>(key: string, ttlMs = DEFAULT_TTL_MS): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  const value = decodeEnvelope<T>(raw, ttlMs);
  if (raw && value === null) await AsyncStorage.removeItem(key).catch(() => undefined);
  return value;
}

export async function writeLocalDraft<T>(key: string, data: T) {
  const envelope: Envelope<T> = { version: 1, savedAt: Date.now(), data };
  await AsyncStorage.setItem(key, JSON.stringify(envelope));
}

export async function removeLocalDraft(key: string) {
  await AsyncStorage.removeItem(key).catch(() => undefined);
}

export async function readSecureDraft<T>(key: string, ttlMs = DEFAULT_TTL_MS): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key);
  const value = decodeEnvelope<T>(raw, ttlMs);
  if (raw && value === null) await SecureStore.deleteItemAsync(key).catch(() => undefined);
  return value;
}

export async function writeSecureDraft<T>(key: string, data: T) {
  const envelope: Envelope<T> = { version: 1, savedAt: Date.now(), data };
  await SecureStore.setItemAsync(key, JSON.stringify(envelope), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function removeSecureDraft(key: string) {
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}