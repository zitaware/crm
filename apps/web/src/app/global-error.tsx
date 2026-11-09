'use client';

/**
 * Explicit global-error boundary. Next.js renders global-error INSTEAD of
 * the root layout, so none of the app's providers exist here — this must
 * render its own <html>/<body> and must not depend on any context. Beyond
 * being the real top-level error screen, supplying this file replaces
 * Next's auto-generated `/_global-error`, whose internal version crashes
 * the production build on some platforms ("Cannot read properties of null
 * (reading 'useContext')" — vercel/next.js #95741, #86178, #84994). Kept
 * minimal on purpose: no AntD, no hooks beyond the reset callback.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '48px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>An unexpected error occurred. Please try again.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ fontSize: '14px', padding: '8px 16px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
