import { createTRPCReact } from "@trpc/react-query";

// The legacy root `server/routers` module no longer exists in this deployment.
// Keep the tRPC helper available for demo/placeholder components without
// coupling the shell typecheck to a removed backend entry point.
type AppRouter = any;

export const trpc = createTRPCReact<AppRouter>();
