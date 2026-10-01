import { cleanup } from "@reelstr/testkit";
import { seed } from "./seed";
import { startStack } from "./stack";

const log = (s: string) => console.log(`[demo] ${s}`);
const stack = await startStack(log);
let who: Awaited<ReturnType<typeof seed>> | undefined;
if (!process.argv.includes("--no-seed")) who = await seed(stack, log);

console.log(`
  Reelstr demo is running (everything local; nothing touches a public relay or real money)

  Cinema (watch, unlock, rate)  ${stack.cinemaUrl}
  Studio (create, fork, curate) ${stack.studioUrl}

  Mint (test sats, no value)    ${stack.mintUrl}
  Agent to commission           ${stack.agentPubkey}   (model: mock-open-1)
${
  who
    ? `
  Sign in as someone (paste the nsec on the login screen):
    Mara (story author)   ${who.mara}
    Dev  (forked scenes)  ${who.dev}
    Ila  (curator)        ${who.ila}
`
    : ""
}
  Ctrl+C stops everything and discards all demo data.
`);
process.on("SIGINT", () => {
  stack.stop();
  cleanup();
  process.exit(0);
});
await new Promise(() => {});
