// Shared shell for unauthenticated screens (login, accept-invite,
// forgot-password, reset-password). None of these have a paired HTML
// prototype (docs/16 §7.1 only covers the authenticated shell/masters
// bundle) — this is a NEW_REQUIRED screen family per docs/04 §18, built to
// the same card/typography/color language as the rest of the system
// (docs/15 §11.1 standard card, §6.1 fonts) rather than the AppShell, since
// there is no sidebar/topbar context before a session exists.
//
// From the lg breakpoint the Zitaware "Command & Control Center" artwork
// fills the left side (ADR-192). It is shown whole (object-contain) on its
// own edge colour, so neither the headline nor the laptop is ever cropped;
// below lg it is hidden and the logo sits above the form instead.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1">
      <aside className="relative hidden min-w-0 flex-1 items-center justify-center overflow-hidden bg-hero lg:flex">
        <div className="relative w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, matching the rest of the auth shell (no next/image in this app) */}
          <img
            src="/auth-hero.jpg"
            alt="Zitaware Solutions internal CRM portal — Command & Control Center: manage projects, track progress, drive operations"
            width={1672}
            height={941}
            className="block h-auto w-full"
          />
          {/* Feather the artwork's top and bottom edges into the panel. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[14%] bg-gradient-to-b from-hero to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[14%] bg-gradient-to-t from-hero to-transparent" />
        </div>
      </aside>

      <main className="flex w-full items-center justify-center bg-app px-4 py-10 lg:w-[500px] lg:shrink-0 xl:w-[540px]">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 flex flex-col items-center gap-2 lg:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, matching SidebarNavigation's own logo usage (packages/ui has no next/image dependency) */}
            <img src="/logo-lockup.png" alt="Zitaware Solutions" width={900} height={187} className="h-[40px] w-auto" />
            <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-2">Internal CRM Portal</span>
          </div>
          <div className="rounded-ui border border-ui border-t-[3px] border-t-highlight bg-surface p-6 shadow-ui">{children}</div>
        </div>
      </main>
    </div>
  );
}
