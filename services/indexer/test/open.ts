import pg from "pg";
import { Indexer } from "../src";

let n = 0;
let swept: Promise<void> | null = null;

/** Drop schemas left behind by earlier runs whose tests did not close their indexer. */
function sweep(url: string) {
  swept ??= (async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const { rows } = await c.query<{ schema_name: string }>(
      "select schema_name from information_schema.schemata where schema_name like 'test\\_%'",
    );
    for (const r of rows) await c.query(`drop schema if exists ${r.schema_name} cascade`);
    await c.end();
  })();
  return swept;
}

/**
 * Open an indexer for a test. With TEST_DATABASE_URL set (e.g. the compose Postgres) every test gets
 * its own throwaway schema on that real server; otherwise it runs on embedded PGlite.
 */
export const openIx = async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return Indexer.open();
  await sweep(url);
  return Indexer.open(url, { schema: `test_${process.pid}_${Date.now().toString(36)}_${++n}` });
};
