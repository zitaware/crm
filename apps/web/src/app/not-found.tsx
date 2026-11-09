import Link from 'next/link';

/**
 * Explicit not-found page. Beyond being the real 404 screen, supplying this
 * file stops Next.js from prerendering its own auto-generated `/_not-found`,
 * whose internal version crashes the production build on some platforms
 * ("Cannot read properties of null (reading 'useState')" — vercel/next.js
 * #95741 and related). Kept deliberately minimal: a plain server component
 * with no hooks and no AntD, so its own prerender can't reintroduce the bug.
 */
export default function NotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '48px', textAlign: 'center' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600 }}>404 — Page not found</h1>
      <p style={{ color: '#6b7280', fontSize: '14px' }}>The page you’re looking for doesn’t exist or has moved.</p>
      <Link href="/" style={{ fontSize: '14px', textDecoration: 'underline' }}>
        Go to dashboard
      </Link>
    </div>
  );
}
