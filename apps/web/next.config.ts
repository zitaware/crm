import type { NextConfig } from "next";

// No build workarounds. The "/_global-error prerender crash" once blamed on an
// upstream Next.js bug was NODE_ENV=development leaking into `next build`
// from a sourced .env, which loads React's development build next to the
// production one (ADR-106). The package's `build` script now pins
// NODE_ENV=production, so the crash cannot recur from the shell.
const nextConfig: NextConfig = {
  // Compile workspace packages in the dev server so a dist rebuild shows up
  // on the next request without a manual restart.
  transpilePackages: ['@zitaware/ui', '@zitaware/config', '@zitaware/contracts'],
  // There are no tenders in Zitaware CRM (ADR-192); old links land on Leads.
  async redirects() {
    return [
      { source: '/tenders', destination: '/leads', permanent: false },
      { source: '/tenders/:path*', destination: '/leads', permanent: false },
      // No EMD/SD either (ADR-192).
      { source: '/emd-sd', destination: '/', permanent: false },
      { source: '/emd-sd/:path*', destination: '/', permanent: false },
      { source: '/reports/emd-sd-recovery', destination: '/reports', permanent: false },
    ];
  },
};

export default nextConfig;
