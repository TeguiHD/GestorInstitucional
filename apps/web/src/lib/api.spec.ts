import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, configureAuthHandlers, fetchBlob, setAccessToken, uploadFormData } from './api';

function jwt(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp })}.sig`;
}

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: vi.fn().mockResolvedValue(body),
  };
}

function blobResponse(blob: Blob) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    blob: vi.fn().mockResolvedValue(blob),
  };
}

describe('uploadFormData', () => {
  afterEach(() => {
    setAccessToken(null);
    configureAuthHandlers({});
    vi.unstubAllGlobals();
  });

  it('envía multipart con bearer token y cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('access-token');

    const form = new FormData();
    form.append('reason', 'Control médico');
    const result = await uploadFormData('/justifications/upload', form);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/justifications/upload',
      expect.objectContaining({
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: { Authorization: 'Bearer access-token' },
      }),
    );
  });

  it('refresca y reintenta multipart cuando expira la sesion corta', async () => {
    const now = Math.floor(Date.now() / 1000);
    const oldToken = jwt(now + 3600);
    const newToken = jwt(now + 7200);
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      const [url] = args;
      if (url.endsWith('/justifications/upload') && fetchMock.mock.calls.length === 1) {
        return jsonResponse({ message: 'Token inválido o expirado' }, { ok: false, status: 401 });
      }
      if (url.endsWith('/auth/refresh')) return jsonResponse({ accessToken: newToken });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(oldToken);

    const form = new FormData();
    form.append('reason', 'Control médico');
    await expect(uploadFormData('/justifications/upload', form)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        body: form,
        headers: { Authorization: `Bearer ${newToken}` },
      }),
    );
  });

  it('propaga mensajes de error del API', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { message: 'Sin acceso' },
            { ok: false, status: 403, statusText: 'Forbidden' },
          ),
        ),
    );

    await expect(uploadFormData('/justifications/upload', new FormData())).rejects.toMatchObject({
      status: 403,
      message: 'Sin acceso',
    });
  });
});

describe('api auth refresh', () => {
  afterEach(() => {
    setAccessToken(null);
    configureAuthHandlers({});
    vi.unstubAllGlobals();
  });

  it('reintenta una request json con un access token nuevo despues de 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const oldToken = jwt(now + 3600);
    const newToken = jwt(now + 7200);
    const onTokenRefresh = vi.fn();
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      const [url] = args;
      if (url.endsWith('/attendance') && fetchMock.mock.calls.length === 1) {
        return jsonResponse({ message: 'Token inválido o expirado' }, { ok: false, status: 401 });
      }
      if (url.endsWith('/auth/refresh')) return jsonResponse({ accessToken: newToken });
      return jsonResponse({ ok: true });
    });
    configureAuthHandlers({ onTokenRefresh });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(oldToken);

    await expect(api.post('/attendance', { courseId: 'c1' })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onTokenRefresh).toHaveBeenCalledWith(newToken);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oldToken}` },
      }),
    );
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` },
      }),
    );
  });

  it('comparte un solo refresh para requests concurrentes con token vencido', async () => {
    const now = Math.floor(Date.now() / 1000);
    const newToken = jwt(now + 7200);
    let refreshCount = 0;
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      const [url] = args;
      if (url.endsWith('/auth/refresh')) {
        refreshCount++;
        await new Promise((resolve) => setTimeout(resolve, 0));
        return jsonResponse({ accessToken: newToken });
      }
      return jsonResponse({ ok: true, url });
    });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(jwt(now - 10));

    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    expect(refreshCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const resourceCalls = fetchMock.mock.calls.filter(
      ([url]) => !String(url).endsWith('/auth/refresh'),
    );
    expect(resourceCalls).toHaveLength(3);
    for (const [, init] of resourceCalls) {
      expect(init).toEqual(
        expect.objectContaining({
          headers: { Authorization: `Bearer ${newToken}` },
        }),
      );
    }
  });

  it('limpia la sesion y propaga error si el refresh falla', async () => {
    const now = Math.floor(Date.now() / 1000);
    const onSessionExpired = vi.fn();
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      const [url] = args;
      if (url.endsWith('/attendance')) {
        return jsonResponse({ message: 'Token inválido o expirado' }, { ok: false, status: 401 });
      }
      return jsonResponse(
        { message: 'Sin sesión activa' },
        { ok: false, status: 401, statusText: 'Unauthorized' },
      );
    });
    configureAuthHandlers({ onSessionExpired });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(jwt(now + 3600));

    await expect(api.get('/attendance')).rejects.toMatchObject({
      status: 401,
      message: 'Sin sesión activa',
    });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('no intenta refresh recursivo en endpoints de auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'Credenciales inválidas' }, { ok: false, status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(jwt(Math.floor(Date.now() / 1000) - 10));

    await expect(api.post('/auth/login', { email: 'a', password: 'b' })).rejects.toMatchObject({
      status: 401,
      message: 'Credenciales inválidas',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/login');
  });

  it('refresca y reintenta descargas blob', async () => {
    const now = Math.floor(Date.now() / 1000);
    const oldToken = jwt(now + 3600);
    const newToken = jwt(now + 7200);
    const file = new Blob(['xlsx']);
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      const [url] = args;
      if (
        url.endsWith('/reports/course/c1/excel?year=2026&month=5') &&
        fetchMock.mock.calls.length === 1
      ) {
        return jsonResponse({ message: 'Token inválido o expirado' }, { ok: false, status: 401 });
      }
      if (url.endsWith('/auth/refresh')) return jsonResponse({ accessToken: newToken });
      return blobResponse(file);
    });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken(oldToken);

    await expect(fetchBlob('/reports/course/c1/excel?year=2026&month=5')).resolves.toBe(file);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({ headers: { Authorization: `Bearer ${newToken}` } }),
    );
  });
});
