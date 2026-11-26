/**
 * Theme factory: turns the Spike tokens into one MUI theme (ported from the Spike Admin UI
 * system, src/theme/createAppTheme.ts). Re-run when the colour mode changes.
 */
import { alpha, createTheme, type Theme } from '@mui/material/styles';
import { darkPalette, FONT_STACK, LAYOUT, lightPalette, shadowTokens } from './tokens';

export type ThemeMode = 'light' | 'dark';

export const createAppTheme = (mode: ThemeMode): Theme => {
  const isDark = mode === 'dark';
  const base = isDark ? darkPalette : lightPalette;
  const shadows = isDark ? shadowTokens.dark : shadowTokens.light;
  const radius = LAYOUT.radius;
  const inputRadius = Math.max(4, Math.round(radius * 0.5));

  const theme = createTheme({
    palette: {
      mode,
      primary: base.primary,
      secondary: base.secondary,
      success: base.success,
      info: base.info,
      warning: base.warning,
      error: base.error,
      grey: base.grey,
      text: base.text,
      background: { default: base.background.default, paper: base.background.paper },
      divider: base.divider,
      action: { hover: base.hover, hoverOpacity: 0.02, disabledBackground: alpha(isDark ? '#FFFFFF' : '#495258', 0.12) },
    },
    shape: { borderRadius: radius },
    typography: {
      fontFamily: FONT_STACK,
      htmlFontSize: 16,
      fontSize: 14,
      h1: { fontWeight: 600, fontSize: '2.25rem', lineHeight: '2.75rem' },
      h2: { fontWeight: 600, fontSize: '1.875rem', lineHeight: '2.25rem' },
      h3: { fontWeight: 600, fontSize: '1.5rem', lineHeight: '1.75rem' },
      h4: { fontWeight: 600, fontSize: '1.3125rem', lineHeight: '1.6rem' },
      h5: { fontWeight: 600, fontSize: '1.125rem', lineHeight: '1.6rem' },
      h6: { fontWeight: 600, fontSize: '1rem', lineHeight: '1.2rem' },
      button: { textTransform: 'none', fontWeight: 500, fontSize: '0.875rem' },
      body1: { fontSize: '0.875rem', fontWeight: 400, lineHeight: '1.334rem' },
      body2: { fontSize: '0.75rem', letterSpacing: '0rem', fontWeight: 400, lineHeight: '1rem' },
      subtitle1: { fontSize: '0.875rem', fontWeight: 400 },
      subtitle2: { fontSize: '0.875rem', fontWeight: 400 },
      caption: { fontSize: '0.75rem', fontWeight: 400 },
      overline: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em' },
    },
    breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
    tokens: { radius, shadows, hover: base.hover, navCaption: base.navCaption, onTint: base.onTint, darkBg: base.background.dark },
  });

  theme.components = {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: base.background.default, transition: 'background-color .25s ease, color .25s ease' },
        '*::-webkit-scrollbar': { width: 7, height: 7 },
        '*::-webkit-scrollbar-thumb': { backgroundColor: alpha(base.text.secondary, 0.35), borderRadius: 8 },
        '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
        a: { color: base.primary.main, textDecoration: 'none' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: radius, boxShadow: shadows.card, backgroundImage: 'none', transition: 'box-shadow .25s ease, background-color .25s ease' } },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 30, '&:last-child': { paddingBottom: 30 } } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, rounded: { borderRadius: radius } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: radius, textTransform: 'none', boxShadow: 'none', fontWeight: 500, padding: '7px 16px', '&:hover': { boxShadow: 'none' } },
        sizeLarge: { padding: '10px 24px', fontSize: '0.9375rem' },
        sizeSmall: { padding: '4px 12px', fontSize: '0.8125rem' },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 500, fontSize: '0.75rem', borderRadius: radius }, sizeSmall: { height: 22, fontSize: '0.6875rem' } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: inputRadius,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: isDark ? base.grey[200] : base.grey[300] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: isDark ? base.grey[300] : base.grey[400] },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1 },
        },
        input: { padding: '12px 14px', '&::placeholder': { color: base.text.secondary, opacity: 0.8 } },
        inputSizeSmall: { padding: '8px 14px' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${base.divider}`, padding: '14px 16px', fontSize: '0.875rem' },
        head: { fontWeight: 600, fontSize: '0.9375rem', color: base.text.primary },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 48, fontSize: '0.875rem' } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: isDark ? base.grey[100] : '#111C2D', fontSize: '0.8125rem', padding: '6px 10px', borderRadius: 10 },
        arrow: { color: isDark ? base.grey[100] : '#111C2D' },
      },
    },
    MuiMenu: { styleOverrides: { paper: { boxShadow: shadows.dropdown, borderRadius: Math.min(radius, 12) } } },
    MuiPopover: { styleOverrides: { paper: { boxShadow: shadows.dropdown, borderRadius: Math.min(radius, 12) } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: radius, boxShadow: shadows.dropdown } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none' } } },
    MuiDivider: { styleOverrides: { root: { borderColor: base.divider } } },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: 6, height: 5, backgroundColor: isDark ? base.grey[200] : base.background.default }, bar: { borderRadius: 6 } },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: Math.min(radius, 12), alignItems: 'center' } } },
    MuiAvatar: { styleOverrides: { root: { fontSize: '0.875rem', fontWeight: 600 } } },
    MuiBadge: { styleOverrides: { badge: { fontWeight: 600 } } },
  };
  return theme;
};
