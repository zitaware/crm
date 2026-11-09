import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="Masters" />);
    expect(screen.getByRole('heading', { name: 'Masters' })).toBeInTheDocument();
  });

  it('renders the description when supplied', () => {
    render(<PageHeader title="Masters" description="Organization-scoped lookup data." />);
    expect(screen.getByText('Organization-scoped lookup data.')).toBeInTheDocument();
  });

  it('omits the description paragraph when none is supplied', () => {
    render(<PageHeader title="Masters" />);
    expect(screen.queryByText(/organization-scoped/i)).not.toBeInTheDocument();
  });

  it('renders actions when supplied', () => {
    render(<PageHeader title="Masters" actions={<button type="button">New Master</button>} />);
    expect(screen.getByRole('button', { name: 'New Master' })).toBeInTheDocument();
  });
});
