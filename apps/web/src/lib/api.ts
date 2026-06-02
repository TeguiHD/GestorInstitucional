/// <reference types="vite/client" />
import DOMPurify from 'dompurify';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

// Module-level token store — avoids circular dep with auth.store
let _accessToken: string | null = null;
let _refreshPromise: Promise<string> | null = null;

type AuthHandlers = {
  onTokenRefresh?: (token: string) => void;
  onSessionExpired?: () => void;
};

let _authHandlers: AuthHandlers = {};

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

export function configureAuthHandlers(handlers: AuthHandlers): void {
  _authHandlers = handlers;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  authToken?: string;
};

type FetchOptions = RequestOptions & {
  formData?: FormData;
  contentType?: 'json' | 'none';
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseErrorMessage(data: unknown, fallback: string): string {
  const raw = (data as { message?: unknown }).message;
  return Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : fallback;
}

async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => ({}));
  return new ApiError(res.status, parseErrorMessage(data, res.statusText), data);
}

function isAuthFlowPath(path: string): boolean {
  return path === '/auth/login' || path === '/auth/refresh' || path === '/auth/logout';
}

function canRefreshRequest(path: string, opts: FetchOptions): boolean {
  return opts.authToken === undefined && !isAuthFlowPath(path);
}

function getJwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    const parsed = JSON.parse(json) as { exp?: unknown };
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function shouldRefreshProactively(token: string): boolean {
  const expiresAt = getJwtExpiryMs(token);
  return expiresAt != null && expiresAt - Date.now() <= ACCESS_TOKEN_REFRESH_SKEW_MS;
}

async function refreshAccessToken(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });

    if (!res.ok) {
      setAccessToken(null);
      _authHandlers.onSessionExpired?.();
      throw await apiErrorFromResponse(res);
    }

    const data = (await res.json()) as { accessToken?: unknown };
    if (typeof data.accessToken !== 'string' || data.accessToken.length === 0) {
      setAccessToken(null);
      _authHandlers.onSessionExpired?.();
      throw new ApiError(401, 'Sin sesión activa', data);
    }

    setAccessToken(data.accessToken);
    _authHandlers.onTokenRefresh?.(data.accessToken);
    return data.accessToken;
  })().finally(() => {
    _refreshPromise = null;
  });

  return _refreshPromise;
}

function buildFetchInit(opts: FetchOptions, token: string | null): RequestInit {
  const headers: Record<string, string> = {};
  if (opts.contentType !== 'none' && (opts.body !== undefined || opts.formData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.formData
      ? { body: opts.formData }
      : opts.body !== undefined
        ? { body: JSON.stringify(opts.body) }
        : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    credentials: 'include',
  };
}

async function fetchWithAuth(path: string, opts: FetchOptions = {}): Promise<Response> {
  const canRefresh = canRefreshRequest(path, opts);
  if (canRefresh && _accessToken && shouldRefreshProactively(_accessToken)) {
    await refreshAccessToken();
  }

  const initialToken = opts.authToken ?? _accessToken;
  let res = await fetch(`${BASE}${path}`, buildFetchInit(opts, initialToken));

  if (res.status === 401 && canRefresh) {
    const tokenChanged = !!initialToken && !!_accessToken && _accessToken !== initialToken;
    const retryToken = tokenChanged ? _accessToken : await refreshAccessToken();
    res = await fetch(`${BASE}${path}`, buildFetchInit(opts, retryToken));
  }

  return res;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await fetchWithAuth(path, opts);

  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function downloadBlob(path: string, filename: string): Promise<void> {
  const res = await fetchWithAuth(path, { contentType: 'none' });
  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetchWithAuth(path, { contentType: 'none' });
  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }
  return res.blob();
}

export async function uploadFormData<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetchWithAuth(path, {
    method: 'POST',
    formData,
    contentType: 'none',
  });

  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown, authToken?: string) =>
    request<T>(path, { method: 'POST', body, ...(authToken !== undefined ? { authToken } : {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  delWithBody: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Safe HTML — sanitize any user-generated content before render. */
export function safeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
