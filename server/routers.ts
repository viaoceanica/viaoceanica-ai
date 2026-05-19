/**
 * Stub router file - actual API is managed in services/platform-core and services/ai-service
 * This file exists only to satisfy TypeScript imports from client/src/lib/trpc.ts
 */
import { initTRPC } from "@trpc/server";

const t = initTRPC.create();

export const appRouter = t.router({});

export type AppRouter = typeof appRouter;
