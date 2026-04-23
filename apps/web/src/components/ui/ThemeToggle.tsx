import { Monitor, Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useTheme, type Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Claro' },
  { value: 'dark', icon: Moon, label: 'Oscuro' },
  { value: 'system', icon: Monitor, label: 'Sistema' },
];

function applyThemeWithTransition(callback: () => void) {
  if (!document.startViewTransition) {
    callback();
    return;
  }
  document.startViewTransition(callback);
}

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => applyThemeWithTransition(() => setTheme(value))}
            className={cn(
              'flex size-7 items-center justify-center rounded-md transition',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
