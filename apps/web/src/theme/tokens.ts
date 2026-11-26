/**
 * Design tokens, ported from the Spike Admin UI system (ssrauf/spike-admin-ui-system,
 * src/theme/tokens). Every colour, shadow and size the UI uses comes from here, so a
 * change in this file restyles every screen. Light and dark values are kept side by side.
 */
export interface StatusColor { main: string; light: string; dark: string; contrastText: string }
export interface ModePalette {
  primary: StatusColor;
  secondary: StatusColor;
  success: StatusColor;
  info: StatusColor;
  warning: StatusColor;
  error: StatusColor;
  grey: Record<100 | 200 | 300 | 400 | 500 | 600, string>;
  text: { primary: string; secondary: string; disabled: string };
  background: { default: string; paper: string; dark: string };
  divider: string;
  hover: string;
  navCaption: string;
  /** Readable text colour on a tinted (`light`) status background. */
  onTint: { success: string; info: string; warning: string; error: string; primary: string; secondary: string };
}

/* Spike "BLUE_THEME" preset, the default (#0085DB). */
export const lightPalette: ModePalette = {
  primary: { main: '#0085DB', light: '#E5F3FB', dark: '#0074BA', contrastText: '#FFFFFF' },
  secondary: { main: '#707A82', light: '#E7ECF0', dark: '#5F6870', contrastText: '#FFFFFF' },
  success: { main: '#4BD08B', light: '#DFFFF3', dark: '#3CB476', contrastText: '#FFFFFF' },
  info: { main: '#46CAEB', light: '#E1F5FA', dark: '#2FB1D2', contrastText: '#FFFFFF' },
  warning: { main: '#F8C076', light: '#FFF6EA', dark: '#E6A853', contrastText: '#FFFFFF' },
  error: { main: '#FB977D', light: '#FFEDE9', dark: '#F27B5C', contrastText: '#FFFFFF' },
  grey: { 100: '#F2F6FA', 200: '#EAEFF4', 300: '#DFE5EF', 400: '#7C8FAC', 500: '#5A6A85', 600: '#111C2D' },
  text: { primary: '#111C2D', secondary: '#707A82', disabled: '#A1AAB2' },
  background: { default: '#F0F5F9', paper: '#FFFFFF', dark: '#2A3547' },
  divider: '#E5EAEF',
  hover: '#F6F9FC',
  navCaption: '#94979E',
  onTint: { success: '#1E9E62', info: '#1A93B5', warning: '#B9781F', error: '#D8573A', primary: '#0074BA', secondary: '#5F6870' },
};

export const darkPalette: ModePalette = {
  primary: { main: '#0085DB', light: '#253662', dark: '#0074BA', contrastText: '#FFFFFF' },
  secondary: { main: '#707A82', light: '#2A3747', dark: '#5F6870', contrastText: '#FFFFFF' },
  success: { main: '#4BD08B', light: '#1B3C47', dark: '#3CB476', contrastText: '#FFFFFF' },
  info: { main: '#46CAEB', light: '#223662', dark: '#2FB1D2', contrastText: '#FFFFFF' },
  warning: { main: '#F8C076', light: '#4D3929', dark: '#E6A853', contrastText: '#FFFFFF' },
  error: { main: '#FB977D', light: '#4B313D', dark: '#F27B5C', contrastText: '#FFFFFF' },
  grey: { 100: '#333F55', 200: '#465670', 300: '#7C8FAC', 400: '#DFE5EF', 500: '#EAEFF4', 600: '#F2F6FA' },
  text: { primary: '#EAEFF4', secondary: '#7C8FAC', disabled: '#5A6A85' },
  background: { default: '#15273A', paper: '#111C2D', dark: '#1B2A3F' },
  divider: '#333F55',
  hover: '#1E2C42',
  navCaption: '#888E97',
  onTint: { success: '#4BD08B', info: '#46CAEB', warning: '#F8C076', error: '#FB977D', primary: '#5BB4F0', secondary: '#AEB7C0' },
};

export const shadowTokens = {
  light: {
    card: '0px 12px 30px -2px rgba(58, 75, 116, 0.14)',
    dropdown: '0px 7px 30px 0px rgba(90, 114, 123, 0.11)',
    fab: '0px 6px 16px rgba(0, 133, 219, 0.35)',
  },
  dark: {
    card: '0px 12px 30px -2px rgba(0, 0, 0, 0.35)',
    dropdown: '0px 7px 30px 0px rgba(0, 0, 0, 0.45)',
    fab: '0px 6px 16px rgba(0, 0, 0, 0.45)',
  },
} as const;

/** Layout constants (px), measured from the Spike reference captures. */
export const LAYOUT = {
  sidebarWidth: 270,
  miniSidebarWidth: 87,
  outerGap: 20,
  headerHeight: 70,
  navItemHeight: 50,
  containerPadding: 24,
  containerMax: 1200,
  radius: 18,
} as const;

export const FONT_STACK = "'Plus Jakarta Sans', sans-serif";
export const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
