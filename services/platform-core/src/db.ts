/**
 * Platform Core — Database Connection (PostgreSQL via Supabase)
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn("[Platform Core DB] DATABASE_URL not set");
      return null;
    }
    try {
      const client = postgres(connectionString, { ssl: "require" });
      _db = drizzle(client);
    } catch (error) {
      console.error("[Platform Core DB] Connection failed:", error);
      return null;
    }
  }
  return _db;
}
