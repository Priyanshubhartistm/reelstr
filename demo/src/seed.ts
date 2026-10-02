import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hexToBytes } from "@noble/hashes/utils.js";
import { MockAdapter } from "@reelstr/agent";
import { ReelstrClient } from "@reelstr/app-core";
import { LocalSigner } from "@reelstr/nostr";
import { buildRating } from "@reelstr/protocol";
import { tempDir } from "@reelstr/testkit";
import { makeScene } from "./footage";
import { demoKeys } from "./stack";
import { SCENES } from "./story";

/** All the seed needs to know about a running stack: where its services are. */
type Stack = {
  endpoints: ConstructorParameters<typeof ReelstrClient>[0] extends infer C
    ? Omit<NonNullable<C>, "signer">
    : never;
};

const THEMES = {
  signal: { c0: "0x0b1d3a", c1: "0x4aa3ff", freq: 220 },
  tower: { c0: "0x2a1033", c1: "0xc04aff", freq: 262 },
  stairs: { c0: "0x1a2f1a", c1: "0x4aff88", freq: 196 },
  broadcast: { c0: "0x3a1010", c1: "0xff5a4a", freq: 330 },
  static: { c0: "0x222222", c1: "0xdddddd", freq: 147 },
};

export interface SeedOptions {
  /** a folder with your own clips named 01-…mp4 to 05-…mp4 (06 is optional): used instead of generated placeholders */
  clipsDir?: string;
  /** what made your clips, recorded on each scene as a closed model (e.g. "veo-3.1"); omit to record nothing */
  model?: string;
  /** include the mock open-weight scene that earns the Source Verified badge (default: only with placeholder footage) */
  verifiedDemo?: boolean;
}

/** `--clips DIR`, `--model NAME`, `--verified-demo` from the command line. */
export function seedOptionsFromArgv(argv = process.argv): SeedOptions {
  const val = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const clipsDir = val("--clips");
  return {
    clipsDir: clipsDir?.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"),
    model: val("--model"),
    verifiedDemo: argv.includes("--verified-demo") ? true : undefined,
  };
}

/** The clip for scene `n` (1-based) in `dir`, matched by its number prefix, or null. */
function findClip(dir: string, n: number): string | null {
  const prefix = String(n).padStart(2, "0");
  const f = readdirSync(dir).find(
    (x) => x.startsWith(`${prefix}-`) && /\.(mp4|mov|webm|m4v)$/i.test(x),
  );
  return f ? join(dir, f) : null;
}

/** The people the demo logs in as. Their keys are printed so a presenter can sign in as them. */
export async function seed(s: Stack, log: (l: string) => void, opts: SeedOptions = {}) {
  if (opts.clipsDir) {
    if (!existsSync(opts.clipsDir)) throw new Error(`clips folder not found: ${opts.clipsDir}`);
    const missing = SCENES.slice(0, 5).filter((_, i) => !findClip(opts.clipsDir as string, i + 1));
    if (missing.length)
      throw new Error(
        `missing clips in ${opts.clipsDir}: ${missing.map((m) => `${m.file}.mp4`).join(", ")} (any of mp4, mov, webm, m4v; the number prefix is what matters)`,
      );
  }
  const verifiedDemo = opts.verifiedDemo ?? !opts.clipsDir;
  const dir = tempDir("reelstr-demo-");
  const k = demoKeys();
  const people = {
    mara: new LocalSigner(hexToBytes(k.mara as string)),
    dev: new LocalSigner(hexToBytes(k.dev as string)),
    ila: new LocalSigner(hexToBytes(k.ila as string)),
  };
  const client = (who: LocalSigner) =>
    new ReelstrClient({ signer: who, ...s.endpoints, powBits: 0 });
  const mara = client(people.mara);
  const dev = client(people.dev);
  const ila = client(people.ila);
  const pm = await people.mara.getPublicKey();
  const pi = await people.ila.getPublicKey();

  // a curator follows the creators she works with: the Desk inbox only shows followed authors' scenes (BE-5)
  const follows = [
    pm,
    await people.dev.getPublicKey(),
    await new LocalSigner(hexToBytes(k.agent as string)).getPublicKey(),
  ];
  await ila.pool.publish(
    await people.ila.signEvent({
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: follows.map((p) => ["p", p]),
      content: "",
    }),
    s.endpoints.relays,
  );

  await mara.createStory({
    d: "last-signal",
    title: "The Last Signal",
    logline: "A radio tower answers a call nobody sent.",
    cast: [{ name: "Wren" }, { name: "The Voice" }],
  });
  const story = { pubkey: pm, d: "last-signal" };

  const make = async (i: number, theme: keyof typeof THEMES) => {
    const own = opts.clipsDir ? findClip(opts.clipsDir, i + 1) : null;
    if (own) return new Uint8Array(await Bun.file(own).arrayBuffer());
    const sc = SCENES[i] as (typeof SCENES)[number];
    return new Uint8Array(
      await Bun.file(
        await makeScene(join(dir, `${sc.file}.mp4`), {
          title: sc.title.toUpperCase(),
          caption: sc.caption,
          ...THEMES[theme],
        }),
      ).arrayBuffer(),
    );
  };
  // what made the clips, if the person said so: recorded honestly as a closed model
  const gen = opts.model
    ? { model: { name: opts.model, open: false }, refs: [] as string[], loras: [] as string[] }
    : undefined;
  const T = (i: number) => SCENES[i] as (typeof SCENES)[number];

  log("seeding scenes (each is uploaded and normalized for real)...");
  const sig = await mara.publishScene({
    bytes: await make(0, "signal"),
    title: T(0).title,
    prompt: T(0).prompt,
    story,
    gen,
  });
  const tower = await dev.forkScene(sig.event, {
    bytes: await make(1, "tower"),
    title: T(1).title,
    prompt: T(1).prompt,
    gen,
  });
  const stairs = await dev.forkScene(sig.event, {
    bytes: await make(2, "stairs"),
    title: T(2).title,
    prompt: T(2).prompt,
    gen,
  });
  const bc = await mara.forkScene(tower.event, {
    bytes: await make(3, "broadcast"),
    title: T(3).title,
    prompt: T(3).prompt,
    gen,
  });
  const st = await ila.forkScene(stairs.event, {
    bytes: await make(4, "static"),
    title: T(4).title,
    prompt: T(4).prompt,
    gen,
  });

  // scene 6: your own clip if you supplied 06; otherwise the mock open-weight scene that earns Source Verified
  // (only when asked for, because its coloured fields look wrong beside real footage); otherwise none
  const ownDawn = opts.clipsDir ? findClip(opts.clipsDir, 6) : null;
  let dawn: typeof sig | null = null;
  if (ownDawn) {
    dawn = await mara.publishScene({
      bytes: new Uint8Array(await Bun.file(ownDawn).arrayBuffer()),
      title: T(5).title,
      prompt: T(5).prompt,
      story,
      parent: { id: sig.event.id },
      gen,
    });
  } else if (verifiedDemo) {
    const aiPrompt = "the radio tower seen from a drone at dawn, mist, slow push-in";
    dawn = await mara.publishScene({
      bytes: await new MockAdapter("mock-open-1").generate({
        prompt: aiPrompt,
        seed: "42",
        refs: [],
        loras: [],
        durationSec: 12,
      }),
      title: T(5).title,
      prompt: aiPrompt,
      story,
      parent: { id: sig.event.id },
      gen: { model: { name: "mock-open-1", open: true }, seed: "42", refs: [], loras: [] },
    });
  }

  const ref = (e: typeof sig, payee: string) => ({
    id: e.event.id,
    sha256: e.ingest.normalized.sha256,
    inSec: 0,
    // the clip's real length, up to 10 s (a Veo clip is 8 s)
    outSec: Math.min(10, Math.floor(e.ingest.probe.durationSec * 10) / 10),
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
    scenes: [ref(sig, pm), ref(stairs, pd), ref(st, pi), ...(dawn ? [ref(dawn, pm)] : [])],
    scenesSources: [src(sig), src(stairs), src(st), ...(dawn ? [src(dawn)] : [])],
    price: { amount: 21 },
  });
  await ila.publishSeries({
    slug: "last-signal",
    title: "The Last Signal",
    summary: "A radio tower answers a call nobody sent. Two branches, one curator.",
    episodes: [1, 2],
    freeEpisodes: 1,
  });

  // two more short series from the same scenes, so the catalogue is more than one tile
  const extra = [
    {
      slug: "static-hours",
      title: "Static Hours",
      summary: "Every channel says the same thing. Someone is listening back.",
      cut: {
        episode: 1,
        title: "Dead air",
        synopsis: "The speakers wake up.",
        scenes: [stairs, st],
        price: 15,
      },
    },
    ...(dawn
      ? [
          {
            slug: "dawn-patrol",
            title: "Dawn Patrol",
            summary: "A drone, a tower and a girl who should not be there.",
            cut: {
              episode: 1,
              title: "First light",
              synopsis: "Mist, then a signal.",
              scenes: [dawn, tower],
              price: 0,
            },
          },
        ]
      : []),
  ];
  for (const x of extra) {
    await ila.publishCut({
      ...base,
      seriesSlug: x.slug,
      episode: x.cut.episode,
      title: x.cut.title,
      synopsis: x.cut.synopsis,
      scenes: x.cut.scenes.map((sc, i) => ref(sc, i % 2 ? pd : pm)),
      scenesSources: x.cut.scenes.map(src),
      price: { amount: x.cut.price },
      free: x.cut.price === 0 || x.cut.episode <= 1,
    });
    await ila.publishSeries({
      slug: x.slug,
      title: x.title,
      summary: x.summary,
      episodes: [1],
      freeEpisodes: 1,
    });
  }

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
