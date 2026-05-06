/// <reference types="vite/client" />
import DOMPurify from 'dompurify';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

// Module-level token store — avoids circular dep with auth.store
let _accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  _accessToken = token;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  authToken?: string;
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

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = opts.authToken ?? _accessToken;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    credentials: 'include',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const raw = (data as { message?: unknown }).message;
    const msg = Array.isArray(raw)
      ? raw.join(', ')
      : typeof raw === 'string'
        ? raw
        : res.statusText;
    throw new ApiError(res.status, msg, data);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function downloadBlob(path: string, filename: string): Promise<void> {
  const token = _accessToken;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : res.statusText;
    throw new ApiError(res.status, message, data);
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

export async function uploadFormData<T>(path: string, formData: FormData): Promise<T> {
  const token = _accessToken;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const raw = (data as { message?: unknown }).message;
    const message = Array.isArray(raw)
      ? raw.join(', ')
      : typeof raw === 'string'
        ? raw
        : res.statusText;
    throw new ApiError(res.status, message, data);
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
};

/** Safe HTML — sanitize any user-generated content before render. */
export function safeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
