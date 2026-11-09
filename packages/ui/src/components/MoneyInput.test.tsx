import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoneyInput, amountInIndianUnits } from './MoneyInput';

describe('MoneyInput', () => {
  it('displays a bound decimal string with Indian digit grouping', () => {
    render(<MoneyInput aria-label="amount" value="3254833" onChange={() => {}} />);
    expect(screen.getByLabelText('amount')).toHaveValue('32,54,833');
  });

  it('groups a settled decimal value', () => {
    // rc-input-number's own MiniDecimal normalizes the incoming value
    // before our formatter ever sees it, so a trailing zero doesn't
    // survive here — the numeric value is unaffected, this only
    // concerns cosmetic trailing-zero display. The always-2-decimal
    // guarantee lives in the read-only formatMoney() label, not here.
    render(<MoneyInput aria-label="amount" value="1200.50" onChange={() => {}} />);
    expect(screen.getByLabelText('amount')).toHaveValue('1,200.5');
  });

  it('renders empty for an empty or missing value', () => {
    render(<MoneyInput aria-label="amount" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('amount')).toHaveValue('');
  });

  it('reports the bound value to onChange without commas, even when the displayed text has them', () => {
    const handleChange = vi.fn();
    render(<MoneyInput aria-label="amount" value="1200" onChange={handleChange} />);
    const input = screen.getByLabelText('amount');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1,23,000' } });

    expect(handleChange).toHaveBeenCalledWith('123000');
  });
});

describe('amountInIndianUnits', () => {
  it('reads an amount in Crore, Lakh and Thousand', () => {
    expect(amountInIndianUnits('12540500')).toBe('₹ 1 Crore 25 Lakh 40 Thousand 500');
    expect(amountInIndianUnits('6200000')).toBe('₹ 62 Lakh');
    expect(amountInIndianUnits('45000.75')).toBe('₹ 45 Thousand');
    expect(amountInIndianUnits('850')).toBe('₹ 850');
    expect(amountInIndianUnits('1500000000')).toBe('₹ 150 Crore');
  });

  it('is empty without an amount, and reads zero and negatives', () => {
    expect(amountInIndianUnits(undefined)).toBe('');
    expect(amountInIndianUnits('')).toBe('');
    expect(amountInIndianUnits('0')).toBe('₹ 0');
    expect(amountInIndianUnits('-250000')).toBe('−₹ 2 Lakh 50 Thousand');
  });

  it('shows under the input only when asked', () => {
    const { rerender } = render(<MoneyInput aria-label="amount" value="12540500" onChange={() => {}} />);
    expect(screen.queryByText('₹ 1 Crore 25 Lakh 40 Thousand 500')).toBeNull();
    rerender(<MoneyInput aria-label="amount" value="12540500" onChange={() => {}} showInWords />);
    expect(screen.getByText('₹ 1 Crore 25 Lakh 40 Thousand 500')).toBeInTheDocument();
  });
});
