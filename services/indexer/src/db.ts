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
export async function openDb(url?: string, opts: { schema?: string } = {}): Promise<Db> {
  if (url?.startsWith("postgres")) {
    // node-postgres returns bigint (counts, timestamps, msats) as strings; PGlite returns numbers. Make
    // them match: every bigint we store (unix seconds, msats, sats) is far below 2^53.
    const types = {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        oid === 20
          ? (v: string) => Number(v)
          : pg.types.getTypeParser(oid, format as "text")) as never,
    };
    const pool = new pg.Pool({
      connectionString: url,
      options: opts.schema ? `-c search_path=${opts.schema}` : undefined,
      types,
    });
    if (opts.schema) {
      if (!/^[a-z_][a-z0-9_]*$/.test(opts.schema))
        throw new Error("schema must be a plain identifier");
      await pool.query(`create schema if not exists ${opts.schema}`);
    }
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
      close: async () => {
        // a throwaway test schema is dropped on close; a real deployment passes no schema
        if (opts.schema?.startsWith("test_"))
          await pool.query(`drop schema if exists ${opts.schema} cascade`);
        await pool.end();
      },
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
