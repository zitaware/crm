import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@zitaware/contracts';

// Type-only import of the server router — proves end-to-end type safety
// between apps/api and apps/web without either app depending on the
// other's runtime code.
export const trpc = createTRPCReact<AppRouter>();
