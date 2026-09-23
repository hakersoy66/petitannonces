import Constants from 'expo-constants';

const configured = Constants.expoConfig?.extra?.apiUrl as string | undefined;
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || configured || 'https://petitannonces.fr/api').replace(/\/$/, '');
const HEALTH_URL = API_URL.endsWith('/api') ? `${API_URL.slice(0, -4)}/healthz` : `${API_URL}/healthz`;

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: boolean;
};

export type ConnectivityState = 'unknown' | 'online' | 'offline';
type ConnectivityListener = (state: ConnectivityState) => void;
type UnauthorizedListener = () => void;

let connectivityState: ConnectivityState = 'unknown';
const connectivityListeners = new Set<ConnectivityListener>();
const unauthorizedListeners = new Set<UnauthorizedListener>();

function publishConnectivity(next: ConnectivityState) {
  if (connectivityState === next) return;
  connectivityState = next;
  for (const listener of connectivityListeners) listener(next);
}

function publishUnauthorized() {
  for (const listener of unauthorizedListeners) listener();
}

export function getConnectivityState() {
  return connectivityState;
}

export function subscribeConnectivity(listener: ConnectivityListener) {
  connectivityListeners.add(listener);
  listener(connectivityState);
  return () => { connectivityListeners.delete(listener); };
}

export function subscribeUnauthorized(listener: UnauthorizedListener) {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
}

export class ApiError extends Error {
  status: number;
  code: string;
  payload: unknown;
  constructor(status: number, code: string, payload: unknown) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    throw new ApiError(0, timedOut ? 'request_timeout' : 'network_unavailable', { network: true, timedOut });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export async function probeConnectivity(timeoutMs = 5000): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(HEALTH_URL, { method: 'GET', headers: { Accept: 'application/json', 'X-PA-Client': 'native-health' } }, timeoutMs);
    const online = response.ok || (response.status >= 400 && response.status < 500);
    publishConnectivity(online ? 'online' : 'offline');
    return online;
  } catch {
    publishConnectivity('offline');
    return false;
  }
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', 'X-PA-Client': options.token ? 'native-auth' : 'native-public' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const shouldRetry = options.retry ?? method === 'GET';
  const maxAttempts = shouldRetry ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${API_URL}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }, options.timeoutMs ?? 12000, options.signal);

      publishConnectivity('online');
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        const code = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error?: unknown }).error ?? `api_${response.status}`) : `api_${response.status}`;
        if (options.token && response.status === 401) publishUnauthorized();
        if (shouldRetry && attempt + 1 < maxAttempts && [502, 503, 504].includes(response.status)) {
          await wait(350 * (attempt + 1));
          continue;
        }
        throw new ApiError(response.status, code, payload);
      }
      return payload as T;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      const networkFailure = error instanceof ApiError && error.status === 0;
      if (networkFailure && shouldRetry && attempt + 1 < maxAttempts) {
        await wait(350 * (attempt + 1));
        continue;
      }
      if (networkFailure) publishConnectivity('offline');
      throw error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ApiError(0, 'network_unavailable', { network: true });
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, { signal });
}