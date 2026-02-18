import * as React from 'react';
import { cn } from '../../../../lib/utils/cn';

export type ThemeMode = 'clean' | 'pro';

interface ThemeSwitcherProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  className?: string;
}

/**
 * Theme switcher component - toggles between Clean and Pro mode
 * Clean = minimalist design (current CSS)
 * Pro = glassmorphism with Aceternity UI components
 */
export function ThemeSwitcher({ mode, onChange, className }: ThemeSwitcherProps) {
  return (
    <div className={cn('flex items-center gap-2 p-1 rounded-lg bg-c3-bg2', className)}>
      <button
        onClick={() => onChange('clean')}
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200',
          mode === 'clean'
            ? 'bg-c3-bg3 text-c3-tx1 shadow-sm'
            : 'text-c3-tx3 hover:text-c3-tx2'
        )}
      >
        Clean
      </button>
      <button
        onClick={() => onChange('pro')}
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 flex items-center gap-1.5',
          mode === 'pro'
            ? 'glass-card text-c3-tx1 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
            : 'text-c3-tx3 hover:text-c3-tx2'
        )}
      >
        <span>Pro</span>
        {mode === 'pro' && (
          <span className="w-1.5 h-1.5 rounded-full bg-c3-accent animate-pulse" />
        )}
      </button>
    </div>
  );
}

/**
 * Hook to manage theme mode state
 */
export function useThemeMode(defaultMode: ThemeMode = 'clean') {
  const [mode, setMode] = React.useState<ThemeMode>(() => {
    // Load from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('c3-theme-mode');
      return (saved as ThemeMode) || defaultMode;
    }
    return defaultMode;
  });

  React.useEffect(() => {
    // Save to localStorage
    localStorage.setItem('c3-theme-mode', mode);

    // Add class to body for global styling
    document.body.classList.toggle('theme-pro', mode === 'pro');
    document.body.classList.toggle('theme-clean', mode === 'clean');
  }, [mode]);

  return [mode, setMode] as const;
}
