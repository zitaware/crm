import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Topbar } from './Topbar';

describe('Topbar', () => {
  it('renders the display name and derived initials', () => {
    render(
      <Topbar
        breadcrumb="Dashboard"
        displayName="Alkesh Patel"
        onLogout={vi.fn()}
        onOpenMobileNav={vi.fn()}
      />,
    );
    expect(screen.getByText('Alkesh Patel')).toBeInTheDocument();
    expect(screen.getByText('AP')).toBeInTheDocument();
  });

  it('gives the mobile nav button and notification button accessible labels', () => {
    render(
      <Topbar breadcrumb="Dashboard" displayName="Alkesh" onLogout={vi.fn()} onOpenMobileNav={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alerts' })).toBeInTheDocument();
  });

  it('marks the notification button as having unread alerts', () => {
    render(
      <Topbar
        breadcrumb="Dashboard"
        displayName="Alkesh"
        onLogout={vi.fn()}
        onOpenMobileNav={vi.fn()}
        hasUnreadNotifications
      />,
    );
    expect(screen.getByRole('button', { name: 'Alerts (unread)' })).toBeInTheDocument();
  });

  it('calls onOpenMobileNav when the menu button is clicked', () => {
    const onOpenMobileNav = vi.fn();
    render(
      <Topbar breadcrumb="Dashboard" displayName="Alkesh" onLogout={vi.fn()} onOpenMobileNav={onOpenMobileNav} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(onOpenMobileNav).toHaveBeenCalledOnce();
  });

  it('calls onLogout when Sign out is chosen from the user menu', async () => {
    const onLogout = vi.fn();
    render(
      <Topbar breadcrumb="Dashboard" displayName="Alkesh" onLogout={onLogout} onOpenMobileNav={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    fireEvent.click(await screen.findByText('Sign out'));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('shows "No open alerts." when there are no notification items', async () => {
    render(
      <Topbar breadcrumb="Dashboard" displayName="Alkesh" onLogout={vi.fn()} onOpenMobileNav={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }));
    expect(await screen.findByText('No open alerts.')).toBeInTheDocument();
  });

  it('renders notification items and calls their onClick when clicked', async () => {
    const onClick = vi.fn();
    render(
      <Topbar
        breadcrumb="Dashboard"
        displayName="Alkesh"
        onLogout={vi.fn()}
        onOpenMobileNav={vi.fn()}
        hasUnreadNotifications
        notificationItems={[
          { id: 'a1', status: 'OVERDUE', label: 'M1 — Design Approval', sublabel: 'SBMU Portal · Due 10 Jul 2026 · ₹10,00,000', onClick },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Alerts (unread)' }));
    expect(await screen.findByText('M1 — Design Approval')).toBeInTheDocument();
    expect(screen.getByText('SBMU Portal · Due 10 Jul 2026 · ₹10,00,000')).toBeInTheDocument();
    fireEvent.click(screen.getByText('M1 — Design Approval'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows a "+N more" footer only when notificationOverflowCount is truthy', async () => {
    const items = [{ id: 'a1', status: 'DUE', label: 'Alert one', sublabel: 'Project X', onClick: vi.fn() }];
    const { rerender } = render(
      <Topbar
        breadcrumb="Dashboard"
        displayName="Alkesh"
        onLogout={vi.fn()}
        onOpenMobileNav={vi.fn()}
        notificationItems={items}
        notificationOverflowCount={3}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }));
    expect(await screen.findByText(/\+3 more/)).toBeInTheDocument();

    rerender(
      <Topbar
        breadcrumb="Dashboard"
        displayName="Alkesh"
        onLogout={vi.fn()}
        onOpenMobileNav={vi.fn()}
        notificationItems={items}
        notificationOverflowCount={0}
      />,
    );
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });
});
