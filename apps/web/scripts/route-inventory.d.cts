import type { PrismaClient } from '@prisma/client';

type Resolved =
  | { path: string; skip?: undefined; error?: undefined }
  | { skip: string; path?: undefined; error?: undefined }
  | { error: string; path?: undefined; skip?: undefined };

declare const inventory: {
  PUBLIC_ROUTES: Set<string>;
  RESOLVERS: Record<string, string>;
  listRoutes(dir?: string, segments?: string[]): string[];
  resolveRoute(prisma: PrismaClient, route: string, organizationId: string): Promise<Resolved>;
  login(apiUrl: string, email: string, password: string): Promise<Array<{ name: string; value: string }>>;
  targetFromEnv(env?: NodeJS.ProcessEnv): { web: string; api: string; email: string; password: string };
};

export = inventory;
