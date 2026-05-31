import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api, configureAuthHandlers, setAccessToken } from '@/lib/api';

export type AuthUser = {
  sub: string;
  email: string;
  schoolId: string;
  roles: string[];
  totpVerified: boolean;
};

type AuthState = {
  user: AuthUser | null;
  // accessToken lives in memory only (not persisted) — refresh token is an httpOnly cookie
  accessToken: string | null;
  isLoading: boolean;

  setTokens: (access: string) => void;
  clearAuth: () => void;

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
  // Silently restore session from httpOnly cookie — call on app init
  init: () => Promise<void>;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,

      setTokens: (accessToken) => {
        setAccessToken(accessToken); // sync to api.ts module variable
        try {
          const payload = JSON.parse(atob(accessToken.split('.')[1]!)) as AuthUser;
          set({ user: payload, accessToken });
        } catch {
          set({ accessToken });
        }
      },

      clearAuth: () => {
        setAccessToken(null);
        // Remove legacy localStorage keys from previous implementation
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, accessToken: null });
      },

      login: async (email, password, totpCode, deviceToken, rememberDevice) => {
        set({ isLoading: true });
        try {
          const data = await api.post<{
            accessToken?: string;
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

          if (data.accessToken) get().setTokens(data.accessToken);
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
        const { clearAuth } = get();
        try {
          // Cookie is sent automatically via credentials: 'include'
          await api.post('/auth/logout', {});
        } catch {
          // Logout locally even if server request fails
        } finally {
          clearAuth();
        }
      },

      init: async () => {
        if (get().accessToken) return; // already have a token in memory
        try {
          // Cookie sent automatically; server rotates and returns new accessToken
          const data = await api.post<{ accessToken: string }>('/auth/refresh', {});
          get().setTokens(data.accessToken);
        } catch {
          get().clearAuth();
        }
      },
    }),
    {
      name: 'auth',
      // Only persist user for fast initial render — accessToken stays in memory
      partialize: (s) => ({ user: s.user }),
      onRehydrateStorage: () => (state) => {
        // Sync any existing access_token from old localStorage on first load
        const legacy = localStorage.getItem('access_token');
        if (legacy && state && !state.accessToken) {
          state.setTokens(legacy);
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
      },
    },
  ),
);

export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuthenticated = () => useAuthStore((s) => !!s.accessToken && !!s.user);

configureAuthHandlers({
  onTokenRefresh: (accessToken) => useAuthStore.getState().setTokens(accessToken),
  onSessionExpired: () => useAuthStore.getState().clearAuth(),
});
