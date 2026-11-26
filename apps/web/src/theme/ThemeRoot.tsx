/**
 * ThemeRoot: MUI ThemeProvider + CssBaseline + colour-mode state (light / dark, persisted).
 * It also publishes the Spike tokens as CSS variables (--sp-*) so the plain CSS classes in
 * styles.css (btn, input, table, chip …) follow the theme and dark mode exactly like MUI components.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material';
import { createAppTheme, type ThemeMode } from './createAppTheme';
import { darkPalette, lightPalette, shadowTokens, FONT_STACK, MONO_STACK } from './tokens';

const KEY = 'meridian:color-mode';
interface ModeCtx { mode: ThemeMode; toggleMode: () => void }
const Ctx = createContext<ModeCtx>({ mode: 'light', toggleMode: () => {} });
export const useColorMode = () => useContext(Ctx);

function cssVars(mode: ThemeMode) {
  const p = mode === 'dark' ? darkPalette : lightPalette;
  const s = mode === 'dark' ? shadowTokens.dark : shadowTokens.light;
  return {
    ':root': {
      colorScheme: mode,
      '--sp-font': FONT_STACK, '--sp-mono': MONO_STACK,
      '--sp-primary': p.primary.main, '--sp-primary-light': p.primary.light, '--sp-primary-dark': p.primary.dark, '--sp-primary-text': p.onTint.primary,
      '--sp-secondary': p.secondary.main, '--sp-secondary-light': p.secondary.light, '--sp-secondary-text': p.onTint.secondary,
      '--sp-success': p.success.main, '--sp-success-light': p.success.light, '--sp-success-text': p.onTint.success,
      '--sp-info': p.info.main, '--sp-info-light': p.info.light, '--sp-info-text': p.onTint.info,
      '--sp-warning': p.warning.main, '--sp-warning-light': p.warning.light, '--sp-warning-text': p.onTint.warning,
      '--sp-error': p.error.main, '--sp-error-light': p.error.light, '--sp-error-dark': p.error.dark, '--sp-error-text': p.onTint.error,
      '--sp-text': p.text.primary, '--sp-text-2': p.text.secondary, '--sp-text-3': p.text.disabled,
      '--sp-bg': p.background.default, '--sp-paper': p.background.paper, '--sp-dark': p.background.dark,
      '--sp-divider': p.divider, '--sp-hover': p.hover,
      '--sp-grey-100': p.grey[100], '--sp-grey-200': p.grey[200], '--sp-grey-300': p.grey[300], '--sp-grey-400': p.grey[400],
      '--sp-input-border': mode === 'dark' ? p.grey[200] : p.grey[300], '--sp-input-border-hover': mode === 'dark' ? p.grey[300] : p.grey[400],
      '--sp-shadow-card': s.card, '--sp-shadow-dropdown': s.dropdown,
      '--sp-radius': '18px', '--sp-radius-input': '9px', '--sp-radius-sm': '12px',
    },
  } as const;
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v; } catch { /* private mode */ }
    return 'light';
  });
  useEffect(() => { try { localStorage.setItem(KEY, mode); } catch { /* ignore */ } }, [mode]);
  const toggleMode = useCallback(() => setMode((m) => (m === 'dark' ? 'light' : 'dark')), []);
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  return (
    <Ctx.Provider value={{ mode, toggleMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalStyles styles={cssVars(mode)} />
        {children}
      </ThemeProvider>
    </Ctx.Provider>
  );
}
