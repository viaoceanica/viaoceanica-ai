/**
 * Stub schema file - actual database schema is managed in services/platform-core
 * This file exists only to satisfy TypeScript imports from shared/types.ts
 */
export type User = {
  id: number;
  openId: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
};
