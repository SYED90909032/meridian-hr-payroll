import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DateInput } from '../DateInput';
import { ThemeRoot } from '../theme/ThemeRoot';

const renderInput = (props: Partial<React.ComponentProps<typeof DateInput>> = {}) => {
  const onChange = vi.fn();
  render(<ThemeRoot><DateInput value="2026-05-15" onChange={onChange} aria-label="Pay date" {...props} /></ThemeRoot>);
  return { onChange };
};

describe('DateInput', () => {
  it('moves by keyboard and commits the focused day', async () => {
    const user = userEvent.setup(); const { onChange } = renderInput();
    await user.click(screen.getByRole('button', { name: /Pay date/ }));
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '2026-05-16' }) }));
  });
  it('disables dates outside min and max', async () => {
    const user = userEvent.setup(); renderInput({ value: '2026-05-15', min: '2026-05-15', max: '2026-05-16' });
    await user.click(screen.getByRole('button', { name: /Pay date/ }));
    expect(screen.getByRole('gridcell', { name: /14 May 2026/ })).toBeDisabled();
    expect(screen.getByRole('gridcell', { name: /17 May 2026/ })).toBeDisabled();
  });
  it('supports month mode', async () => { const user = userEvent.setup(); const { onChange } = renderInput({ type: 'month', value: '2026-05' }); await user.click(screen.getByRole('button', { name: /Pay date/ })); await user.click(screen.getByRole('button', { name: 'Jun' })); expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '2026-06' }) })); });
  it('supports datetime mode and time controls', async () => { const user = userEvent.setup(); const { onChange } = renderInput({ type: 'datetime-local', value: '2026-05-15T09:00' }); await user.click(screen.getByRole('button', { name: /Pay date/ })); await user.selectOptions(screen.getByRole('combobox', { name: 'Hour' }), '17'); expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '2026-05-15T17:00' }) })); });
});
