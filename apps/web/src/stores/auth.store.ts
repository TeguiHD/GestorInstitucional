import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api, ApiError } from '@/lib/api';

export type AuthUser = {
  sub: string;
  email: string;
  schoolId: string;
  roles: string[];
  totpVerified: boolean;
};

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;

  login: (
    email: string,
    password: string,
    totpCode?: string,
    deviceToken?: string,
    rememberDevice?: boolean,
  ) => Promise<
    | { requiresTotp: false; requiresTotpSetup: false; deviceToken?: string }
    | { requiresTotp: true; requiresTotpSetup: false }
    | { requiresTotp: false; requiresTotpSetup: true; setupToken: string }
  >;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setTokens: (access: string, refresh: string) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,

      setTokens: (accessToken, refreshToken) => {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        // Decode payload without verifying signature (API already verified it)
        try {
          const payload = JSON.parse(atob(accessToken.split('.')[1]!)) as AuthUser;
          set({ user: payload, accessToken, refreshToken });
        } catch {
          set({ accessToken, refreshToken });
        }
      },

      clearAuth: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, accessToken: null, refreshToken: null });
      },

      login: async (email, password, totpCode, deviceToken, rememberDevice) => {
        set({ isLoading: true });
        try {
          const data = await api.post<{
            accessToken: string;
            refreshToken: string;
            setupToken?: string;
            requiresTotp: boolean;
            requiresTotpSetup: boolean;
            deviceToken?: string;
          }>('/auth/login', {
            email,
            password,
            ...(totpCode ? { totpCode } : {}),
            ...(deviceToken ? { deviceToken } : {}),
            ...(rememberDevice ? { rememberDevice } : {}),
          });

          if (data.requiresTotpSetup && data.setupToken) {
            return { requiresTotp: false, requiresTotpSetup: true, setupToken: data.setupToken };
          }
          if (data.requiresTotp) return { requiresTotp: true, requiresTotpSetup: false };

          get().setTokens(data.accessToken, data.refreshToken);
          return data.deviceToken
            ? {
                requiresTotp: false as const,
                requiresTotpSetup: false as const,
                deviceToken: data.deviceToken,
              }
            : { requiresTotp: false as const, requiresTotpSetup: false as const };
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        const { refreshToken, clearAuth } = get();
        try {
          await api.post('/auth/logout', { refreshToken });
        } catch {
          // Logout even if server request fails
        } finally {
          clearAuth();
        }
      },

      refresh: async () => {
        const { refreshToken, setTokens, clearAuth } = get();
        if (!refreshToken) {
          clearAuth();
          return;
        }
        try {
          const data = await api.post<{ accessToken: string; refreshToken: string }>(
            '/auth/refresh',
            { refreshToken },
          );
          setTokens(data.accessToken, data.refreshToken);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) clearAuth();
        }
      },
    }),
    {
      name: 'auth',
      partialize: (s) => ({ refreshToken: s.refreshToken, user: s.user }),
    },
  ),
);

export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuthenticated = () => useAuthStore((s) => !!s.accessToken && !!s.user);
