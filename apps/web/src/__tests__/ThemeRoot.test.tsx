import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { ThemeRoot, useColorMode } from '../theme/ThemeRoot';

function Probe() { const { mode, toggleMode } = useColorMode(); return <button onClick={toggleMode} aria-label="toggle theme">{mode}</button>; }
describe('theme toggle', () => {
  beforeEach(() => localStorage.clear());
  it('toggles and persists dark mode', async () => { const user = userEvent.setup(); render(<ThemeRoot><Probe /></ThemeRoot>); const button = screen.getByRole('button', { name: 'toggle theme' }); expect(button).toHaveTextContent('light'); await user.click(button); expect(button).toHaveTextContent('dark'); expect(localStorage.getItem('meridian:color-mode')).toBe('dark'); });
});
