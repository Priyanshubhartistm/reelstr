import { FilmArt, Wordmark } from "@reelstr/ui";

const REPO = "https://github.com/Priyanshubhartistm/reelstr";

const STEPS = [
  {
    tone: "tone-0",
    n: "1",
    title: "Make a scene",
    body: "Upload a 10 to 15 second clip, or commission a bot. Branch from anyone's scene and the original creator is credited automatically.",
  },
  {
    tone: "tone-1",
    n: "2",
    title: "Cut an episode",
    body: "A curator picks scenes into a 60 to 120 second episode, sets a price and publishes. The split is signed into the episode.",
  },
  {
    tone: "tone-2",
    n: "3",
    title: "Get paid",
    body: "Viewers unlock with sats. Each person's share follows the seconds of their scene that made the cut.",
  },
];

const FEATURES = [
  [
    "Forkable, not locked",
    "A scene is a file addressed by its hash, stored on any Blossom server. Anyone can continue it.",
  ],
  [
    "Splits you can check",
    "The episode declares who gets what. A second, independent reader recomputes it from the raw events.",
  ],
  [
    "AI you can verify",
    "Open-weight scenes publish their seed and references. A verifier you choose re-renders them and signs the result.",
  ],
  [
    "Your key, no account",
    "Sign in with a Nostr extension, a remote signer or a key you hold. There is no email and no password.",
  ],
  [
    "Private crews",
    "Draft with your crew in a private room. Nothing is public until someone releases it.",
  ],
  [
    "Bots paid on acceptance",
    "Commission a scene from an agent. You pay only if you accept what it delivers.",
  ],
];

/** The public page: what this is, how it works, and what is and is not proven yet. */
export function Landing() {
  return (
    <>
      <header className="bar">
        <a className="brand" href="#/">
          <Wordmark />
        </a>
        <nav aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#why">What is different</a>
          <a href="#status">Status</a>
        </nav>
        <span className="grow" />
        <a className="btn" href="#/signin">
          Launch the app
        </a>
      </header>
      <main className="wrap landing">
        <section className="hero">
          <FilmArt />
          <div className="label">Open source · built on Nostr</div>
          <h1>Stories anyone can fork. Episodes that pay everyone who made them.</h1>
          <p className="muted" style={{ maxWidth: "38rem", fontSize: "1.1rem" }}>
            Reelstr is a micro-drama platform with no owner. Short AI-made scenes branch like code,
            curators cut the best branches into episodes, and viewers pay per episode in sats. The
            revenue split is written into the episode, where anyone can check it.
          </p>
          <div className="row tight" style={{ marginTop: "1.4rem" }}>
            <a className="btn" href="#/signin">
              Launch the app
            </a>
            <a className="btn btn-plain" href="#how">
              How it works
            </a>
          </div>
          <div className="row tight" style={{ marginTop: "1.4rem", gap: "0.5rem" }}>
            <span className="pill">Free to watch the first episodes</span>
            <span className="pill">Pay in sats</span>
            <span className="pill">Splits are public</span>
          </div>
        </section>

        <div id="how" className="label" style={{ margin: "2rem 0 0.7rem" }}>
          How it works
        </div>
        <div className="grid grid-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className={`cover ${s.tone}`}
              style={{ minHeight: "13rem", cursor: "default" }}
            >
              <div>
                <span
                  className="step-no"
                  style={{ background: "var(--card)", color: "var(--ink)" }}
                >
                  {s.n}
                </span>
                <div className="cover-title" style={{ marginTop: "0.9rem" }}>
                  {s.title}
                </div>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div id="why" className="label" style={{ margin: "2rem 0 0.7rem" }}>
          What is different
        </div>
        <div className="grid grid-3">
          {FEATURES.map(([t, b]) => (
            <div key={t} className="card" style={{ margin: 0 }}>
              <h3>{t}</h3>
              <p className="muted" style={{ marginBottom: 0 }}>
                {b}
              </p>
            </div>
          ))}
        </div>

        <div id="status" className="label" style={{ margin: "2rem 0 0.7rem" }}>
          Status
        </div>
        <div className="card card-soft">
          <h3>A working build, not a launched product</h3>
          <p>
            Everything above runs end to end. Payments use test sats today: real Lightning is tested
            on a private regtest chain, and no live video model has generated a scene yet. Nothing
            on this page asks you to trust us, so the details of what was checked, and against what,
            are written down.
          </p>
          <div className="row tight">
            <a className="btn btn-plain" href={`${REPO}/blob/master/docs/STATUS.md`}>
              What is verified
            </a>
            <a className="btn btn-plain" href={`${REPO}/blob/master/docs/nip/reelstr.md`}>
              The protocol draft
            </a>
            <a className="btn btn-plain" href={REPO}>
              Source on GitHub
            </a>
          </div>
        </div>

        <section className="hero cta" style={{ marginTop: "2rem" }}>
          <h1 style={{ marginBottom: "0.75rem" }}>Watch one, or make one.</h1>
          <a className="btn" href="#/signin">
            Launch the app
          </a>
        </section>
        <p className="muted" style={{ textAlign: "center", fontSize: "0.85rem" }}>
          reelstr · MIT licensed · scenes and payments move over Nostr, Blossom and Cashu
        </p>
      </main>
    </>
  );
}
