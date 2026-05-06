import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken, uploadFormData } from './api';

describe('uploadFormData', () => {
  afterEach(() => {
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('envía multipart con bearer token y cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
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

  it('propaga mensajes de error del API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: vi.fn().mockResolvedValue({ message: 'Sin acceso' }),
      }),
    );

    await expect(uploadFormData('/justifications/upload', new FormData())).rejects.toMatchObject({
      status: 403,
      message: 'Sin acceso',
    });
  });
});
