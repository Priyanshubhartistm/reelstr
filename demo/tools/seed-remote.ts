import { seed, seedOptionsFromArgv } from "../src/seed";

/**
 * Seed a stack that is already running (compose, or a VM): the same story the local demo tells.
 *   bun demo/tools/seed-remote.ts [--host <PUBLIC_HOST>]      default localhost
 *   bun demo/tools/seed-remote.ts --public-base https://host/reelstr   behind a reverse proxy
 *   add  --clips ~/my-clips [--model veo-3.1]  to use your own clips (docs/SHOWCASE.md)
 * Uses the stable demo identities from demo/.demo-keys.json.
 */
const host = process.argv.includes("--host")
  ? (process.argv[process.argv.indexOf("--host") + 1] as string)
  : "localhost";
// --public-base https://host/reelstr : the services sit behind a reverse proxy under one hostname
const base = process.argv.includes("--public-base")
  ? (process.argv[process.argv.indexOf("--public-base") + 1] as string).replace(/\/+$/, "")
  : "";
const endpoints = base
  ? {
      relays: [`${base.replace(/^http/, "ws")}/relay`],
      blossom: `${base}/blossom`,
      mirrors: [],
      mediaUrl: `${base}/media`,
      indexerUrl: `${base}/api`,
      keysUrl: `${base}/keys`,
    }
  : {
      relays: [`ws://${host}:3334`],
      blossom: `http://${host}:3100`,
      mirrors: [],
      mediaUrl: `http://${host}:3200`,
      indexerUrl: `http://${host}:3300`,
      keysUrl: `http://${host}:3400`,
    };
const who = await seed({ endpoints }, (l) => console.log(`[seed] ${l}`), seedOptionsFromArgv());
console.log(`
Seeded. Open:
  Reelstr  http://${host}:5173
Sign in as (paste the nsec):
  Mara  ${who.mara}
  Dev   ${who.dev}
  Ila   ${who.ila}
`);
process.exit(0);
