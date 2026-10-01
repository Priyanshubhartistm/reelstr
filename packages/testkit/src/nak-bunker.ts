import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const nakPath = () =>
  [process.env.NAK, join(homedir(), "go/bin/nak"), Bun.which("nak") ?? ""].find(
    (p) => p && existsSync(p),
  );

/**
 * Start fiatjaf's real NIP-46 bunker (`nak bunker`, https://github.com/fiatjaf/nak) for `secHex`,
 * listening on `relay`. Returns its `bunker://` URI, or null if nak is not installed
 * (`go install github.com/fiatjaf/nak@latest`, or set NAK to the binary).
 */
export async function startNakBunker(o: { relay: string; secHex: string }) {
  const bin = nakPath();
  if (!bin) return null;
  const secret = "reelstr-test-secret";
  const p = Bun.spawn([bin, "bunker", "--sec", o.secHex, "-s", secret, o.relay], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let seen = "";
  let resolve: (u: string) => void = () => {};
  const found = new Promise<string>((r) => {
    resolve = r;
  });
  const pump = async (s: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    for await (const c of s as unknown as AsyncIterable<Uint8Array>) {
      seen += dec.decode(c);
      const m = seen.match(/bunker:\/\/\S+/);
      if (m) resolve(m[0]);
    }
  };
  void pump(p.stdout);
  void pump(p.stderr);
  const printed = await Promise.race([
    found,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`nak bunker printed no URI: ${seen.slice(-300)}`)), 15_000),
    ),
  ]);
  // nak's printed URI carries a one-time secret; ours reuses the authorized one so several clients can connect
  const u = new URL(printed.replace("bunker://", "http://"));
  const uri = `bunker://${u.hostname}?relay=${encodeURIComponent(o.relay)}&secret=${secret}`;
  return { uri, stop: () => p.kill() };
}
