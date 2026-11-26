import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Plus Jakarta Sans: the Spike Admin typeface, self-hosted (no external font request).
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import { ThemeRoot } from './theme/ThemeRoot';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeRoot><App /></ThemeRoot>
  </StrictMode>,
);
