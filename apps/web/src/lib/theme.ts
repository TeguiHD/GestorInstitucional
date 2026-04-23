import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

type ThemeState = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  cycle: () => void;
};

const STORAGE_KEY = 'cssp-theme';

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function apply(theme: Theme) {
  const effective = resolve(theme);
  document.documentElement.classList.toggle('dark', effective === 'dark');
  document.documentElement.style.colorScheme = effective;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (t) => {
        apply(t);
        set({ theme: t });
      },
      cycle: () => {
        const order: Theme[] = ['light', 'dark', 'system'];
        const next = order[(order.indexOf(get().theme) + 1) % order.length]!;
        apply(next);
        set({ theme: next });
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) apply(state.theme);
      },
    },
  ),
);

// Watch system preference changes when in 'system' mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useTheme.getState().theme === 'system') apply('system');
  });
}
