import { join } from "node:path";
import { ReelstrClient } from "@reelstr/app-core";
import { LocalSigner } from "@reelstr/nostr";
import { buildRating } from "@reelstr/protocol";
import { tempDir } from "@reelstr/testkit";
import { makeScene } from "./footage";
import type { startStack } from "./stack";

type Stack = Awaited<ReturnType<typeof startStack>>;

const THEMES = {
  signal: { c0: "0x0b1d3a", c1: "0x4aa3ff", freq: 220 },
  tower: { c0: "0x2a1033", c1: "0xc04aff", freq: 262 },
  stairs: { c0: "0x1a2f1a", c1: "0x4aff88", freq: 196 },
  broadcast: { c0: "0x3a1010", c1: "0xff5a4a", freq: 330 },
  static: { c0: "0x222222", c1: "0xdddddd", freq: 147 },
};

/** The people the demo logs in as. Their keys are printed so a presenter can sign in as them. */
export async function seed(s: Stack, log: (l: string) => void) {
  const dir = tempDir("reelstr-demo-");
  const people = {
    mara: LocalSigner.generate(),
    dev: LocalSigner.generate(),
    ila: LocalSigner.generate(),
  };
  const client = (who: LocalSigner) =>
    new ReelstrClient({ signer: who, ...s.endpoints, powBits: 0 });
  const mara = client(people.mara);
  const dev = client(people.dev);
  const ila = client(people.ila);
  const pm = await people.mara.getPublicKey();
  const pi = await people.ila.getPublicKey();

  await mara.createStory({
    d: "last-signal",
    title: "The Last Signal",
    logline: "A radio tower answers a call nobody sent.",
    cast: [{ name: "Wren" }, { name: "The Voice" }],
  });
  const story = { pubkey: pm, d: "last-signal" };

  const make = async (n: string, title: string, caption: string, theme: keyof typeof THEMES) =>
    new Uint8Array(
      await Bun.file(
        await makeScene(join(dir, `${n}.mp4`), { title, caption, ...THEMES[theme] }),
      ).arrayBuffer(),
    );

  log("seeding scenes (each is uploaded and normalized for real)...");
  const sig = await mara.publishScene({
    bytes: await make("signal", "THE SIGNAL", "3 a.m. A tower hums to life", "signal"),
    title: "The Signal",
    prompt: "an abandoned radio tower at night, a single red light wakes up",
    story,
  });
  const tower = await dev.forkScene(sig.event, {
    bytes: await make("tower", "INTO THE TOWER", "Wren climbs toward the voice", "tower"),
    title: "Into the Tower",
    prompt: "a girl climbs a rusted spiral stair inside the tower",
  });
  const stairs = await dev.forkScene(sig.event, {
    bytes: await make("stairs", "DOWN BELOW", "Another way: under the tower", "stairs"),
    title: "Down Below",
    prompt: "a service hatch, a long tunnel, green emergency light",
  });
  const bc = await mara.forkScene(tower.event, {
    bytes: await make("bc", "THE BROADCAST", "The Voice says her name", "broadcast"),
    title: "The Broadcast",
    prompt: "a vintage microphone glowing, a distorted voice, red light",
  });
  const st = await ila.forkScene(stairs.event, {
    bytes: await make("static", "STATIC", "Every channel says the same thing", "static"),
    title: "Static",
    prompt: "walls of old speakers all showing white noise",
  });

  const ref = (e: typeof sig, payee: string) => ({
    id: e.event.id,
    sha256: e.ingest.normalized.sha256,
    inSec: 0,
    outSec: 10,
    payee,
  });
  const src = (e: typeof sig) => ({
    sha256: e.ingest.normalized.sha256,
    urls: [e.ingest.normalized.url],
  });
  const pd = await people.dev.getPublicKey();
  const base = {
    seriesSlug: "last-signal",
    curatorBps: 2000,
    hostBps: 1000,
    host: pi,
    relay: s.endpoints.relays[0],
  };

  log("curating episodes (server renders HLS ladders, episode 2 is encrypted)...");
  const ep1 = await ila.publishCut({
    ...base,
    episode: 1,
    title: "The Signal",
    synopsis: "A tower wakes. Wren answers.",
    scenes: [ref(sig, pm), ref(tower, pd), ref(bc, pm)],
    scenesSources: [src(sig), src(tower), src(bc)],
    price: { amount: 21 }, // inside the series free window, so it plays free; the credits table shows the real 21-sat split
    free: true,
  });
  const ep2 = await ila.publishCut({
    ...base,
    episode: 2,
    title: "Down Below",
    synopsis: "The other way in.",
    scenes: [ref(sig, pm), ref(stairs, pd), ref(st, pi)],
    scenesSources: [src(sig), src(stairs), src(st)],
    price: { amount: 21 },
  });
  await ila.publishSeries({
    slug: "last-signal",
    title: "The Last Signal",
    summary: "A radio tower answers a call nobody sent. Two branches, one curator.",
    episodes: [1, 2],
    freeEpisodes: 1,
  });

  const cutD = ep1.tags.find((t) => t[0] === "d")?.[1];
  const rate = async (who: LocalSigner, stars: number, review: string) =>
    ila.pool.publish(
      await who.signEvent(
        buildRating({ stars, cutId: ep1.id, cutCoord: `31811:${pi}:${cutD}`, review }),
      ),
      s.endpoints.relays,
    );
  await rate(people.mara, 5, "That ending line gave me chills.");
  await rate(people.dev, 4, "Loved the branch I forked from.");
  void ep2;

  return {
    mara: people.mara.backup(),
    dev: people.dev.backup(),
    ila: people.ila.backup(),
  };
}
