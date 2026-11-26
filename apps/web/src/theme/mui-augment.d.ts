import '@mui/material/styles';

interface AppTokens {
  radius: number;
  shadows: { card: string; dropdown: string; fab: string };
  hover: string;
  navCaption: string;
  darkBg: string;
  onTint: { success: string; info: string; warning: string; error: string; primary: string; secondary: string };
}

declare module '@mui/material/styles' {
  interface Theme { tokens: AppTokens }
  interface ThemeOptions { tokens?: AppTokens }
}
