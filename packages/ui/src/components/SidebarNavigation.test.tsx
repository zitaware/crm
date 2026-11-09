import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNavigation } from './SidebarNavigation';

describe('SidebarNavigation', () => {
  it('shows the Dashboard only when the session can read it', () => {
    render(
      <SidebarNavigation organizationName="Zitaware Solutions" permissions={[]} pathname="/" onNavigate={vi.fn()} />,
    );
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();

    render(
      <SidebarNavigation organizationName="Zitaware Solutions" permissions={['dashboard.read']} pathname="/" onNavigate={vi.fn()} />,
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('hides items the session does not hold the permission for', () => {
    render(
      <SidebarNavigation organizationName="Zitaware Solutions" permissions={[]} pathname="/" onNavigate={vi.fn()} />,
    );
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Masters')).not.toBeInTheDocument();
  });

  it('shows an item once the session holds its required permission', () => {
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read']}
        pathname="/"
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('Masters')).toBeInTheDocument();
  });

  it('never renders a route the prototype had but Phase 2 does not own', () => {
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read', 'user.manage', 'employee.read', 'legal_entity.read', 'financial_year.read', 'audit.read']}
        pathname="/"
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText('Clients')).not.toBeInTheDocument();
    expect(screen.queryByText('Leads')).not.toBeInTheDocument();
  });

  it('renders the organization name in the brand area', () => {
    render(
      <SidebarNavigation organizationName="Zitaware Solutions" permissions={[]} pathname="/" onNavigate={vi.fn()} />,
    );
    expect(screen.getByText('Zitaware Solutions')).toBeInTheDocument();
  });

  it('calls onNavigate with the item path when a menu item is clicked', async () => {
    const onNavigate = vi.fn();
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read']}
        pathname="/"
        onNavigate={onNavigate}
      />,
    );
    const [mastersItem] = screen.getAllByText('Masters');
    mastersItem?.click();
    expect(onNavigate).toHaveBeenCalledWith('/masters');
  });

  it('does not render a collapse toggle when onToggleCollapse is omitted (e.g. the mobile drawer copy)', () => {
    render(
      <SidebarNavigation organizationName="Zitaware Solutions" permissions={[]} pathname="/" onNavigate={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /collapse sidebar|expand sidebar/i })).not.toBeInTheDocument();
  });

  it('hides the organization name and calls onToggleCollapse when collapsed', () => {
    const onToggleCollapse = vi.fn();
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={[]}
        pathname="/"
        onNavigate={vi.fn()}
        collapsed
        onToggleCollapse={onToggleCollapse}
      />,
    );
    expect(screen.queryByText('Zitaware Solutions')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Expand sidebar' }).click();
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('shows the organization name and a Collapse-labeled toggle when expanded with onToggleCollapse provided', () => {
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={[]}
        pathname="/"
        onNavigate={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.getByText('Zitaware Solutions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('renders each permitted group as its own expanded-by-default accordion header', () => {
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read', 'user.manage']}
        pathname="/"
        onNavigate={vi.fn()}
      />,
    );
    const header = screen.getByRole('button', { name: 'Administration' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Masters')).toBeVisible();
  });

  it('collapses a group panel and flips its arrow when the header is clicked, then re-expands on a second click', () => {
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read', 'user.manage']}
        pathname="/"
        onNavigate={vi.fn()}
      />,
    );
    const header = screen.getByRole('button', { name: 'Administration' });

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById('nav-group-administration');
    expect(panel).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveAttribute('aria-hidden', 'false');
  });

  it('auto-expands the group containing the current route even after the user collapsed it', () => {
    const { rerender } = render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read', 'user.manage']}
        pathname="/"
        onNavigate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Administration' }));
    expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read', 'user.manage']}
        pathname="/masters"
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not render accordion group headers in collapsed (icon-only rail) mode', () => {
    render(
      <SidebarNavigation
        organizationName="Zitaware Solutions"
        permissions={['master.read']}
        pathname="/"
        onNavigate={vi.fn()}
        collapsed
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
  });
});
