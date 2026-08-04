import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getEnv } from "@/lib/env";

/**
 * One pool per process. Next.js dev reloads the module graph on every edit, so
 * the pool is parked on globalThis to avoid leaking a connection pool per reload.
 */
declare global {
  var __wildframePool: Pool | undefined;
}

function createPool(): Pool {
  const env = getEnv();
  const needsTls = /supabase\.(co|com)|amazonaws\.com|neon\.tech/.test(env.DATABASE_URL);
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(needsTls ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

export function getPool(): Pool {
  if (!globalThis.__wildframePool) globalThis.__wildframePool = createPool();
  return globalThis.__wildframePool;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a transaction. Used wherever a state transition and its side
 * effects (audit row, asset row) must land together or not at all.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (globalThis.__wildframePool) {
    await globalThis.__wildframePool.end();
    globalThis.__wildframePool = undefined;
  }
}
