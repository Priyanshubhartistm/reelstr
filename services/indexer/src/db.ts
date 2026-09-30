import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** run fn in a transaction */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** PGlite (embedded, for dev/tests) by default; real Postgres when `url` is a postgres:// URL. */
export async function openDb(url?: string): Promise<Db> {
  if (url?.startsWith("postgres")) {
    const pool = new pg.Pool({ connectionString: url });
    const wrap = (c: {
      query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
    }): Db => ({
      query: async (sql, params) => (await c.query(sql, params)).rows as never,
      exec: async (sql) => void (await c.query(sql)),
      tx: async () => {
        throw new Error("nested transaction");
      },
      close: async () => {},
    });
    return {
      ...wrap(pool),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query("begin");
          const r = await fn(wrap(c));
          await c.query("commit");
          return r;
        } catch (e) {
          await c.query("rollback");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const lite = new PGlite(url && url !== "memory" ? url : undefined);
  await lite.waitReady;
  const wrap = (c: { query: PGlite["query"]; exec: PGlite["exec"] }): Db => ({
    query: async (sql, params) => (await c.query(sql, params as never[])).rows as never,
    exec: async (sql) => void (await c.exec(sql)),
    tx: async () => {
      throw new Error("nested transaction");
    },
    close: async () => {},
  });
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t as never))),
    close: () => lite.close(),
  };
}
