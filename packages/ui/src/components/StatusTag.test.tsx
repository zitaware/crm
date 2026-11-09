import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusTag } from './StatusTag';

describe('StatusTag', () => {
  it('renders a title-cased label derived from the status by default', () => {
    render(<StatusTag status="SOFT_CLOSED" />);
    expect(screen.getByText('Soft Closed')).toBeInTheDocument();
  });

  it('renders an explicit label when supplied instead of deriving one', () => {
    render(<StatusTag status="ACTIVE" label="Currently active" />);
    expect(screen.getByText('Currently active')).toBeInTheDocument();
  });

  it('maps a known status to its semantic tone', () => {
    render(<StatusTag status="LOCKED" />);
    expect(screen.getByText('Locked').className).toContain('bg-negative-soft');
  });

  it('falls back to the muted tone for an unrecognized status', () => {
    render(<StatusTag status="SOMETHING_UNMAPPED" />);
    expect(screen.getByText('Something Unmapped').className).toContain('bg-ui-2');
  });

  it('lets an explicit tone override the automatic mapping', () => {
    render(<StatusTag status="ACTIVE" tone="neg" />);
    expect(screen.getByText('Active').className).toContain('bg-negative-soft');
  });
});
