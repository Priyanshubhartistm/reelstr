import { seed } from "./seed";

/**
 * Seed a stack that is already running (compose, or a VM): the same story the local demo tells.
 *   bun demo/src/remote.ts [--host <PUBLIC_HOST>]      default localhost
 * Uses the stable demo identities from demo/.demo-keys.json.
 */
const host = process.argv.includes("--host")
  ? (process.argv[process.argv.indexOf("--host") + 1] as string)
  : "localhost";
const endpoints = {
  relays: [`ws://${host}:3334`],
  blossom: `http://${host}:3100`,
  mirrors: [],
  mediaUrl: `http://${host}:3200`,
  indexerUrl: `http://${host}:3300`,
  keysUrl: `http://${host}:3400`,
};
const who = await seed({ endpoints }, (l) => console.log(`[seed] ${l}`));
console.log(`
Seeded. Open:
  Cinema  http://${host}:5174
  Studio  http://${host}:5173
Sign in as (paste the nsec):
  Mara  ${who.mara}
  Dev   ${who.dev}
  Ila   ${who.ila}
`);
process.exit(0);
