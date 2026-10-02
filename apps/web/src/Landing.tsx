import { FilmArt, TESTNET, Wordmark } from "@reelstr/ui";
import { useEffect, useRef, useState } from "react";

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

/** Words that rise into place one after another. Plain text for screen readers: spaces stay between them. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sentence, never reordered
        <span key={i}>
          <span className="w" style={{ ["--i" as string]: i }}>
            {w}
          </span>{" "}
        </span>
      ))}
    </>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Scroll reveals. Sections below the fold start hidden (class `anim` on the page, set on the very first
 * render so nothing flashes) and are shown, one after another, as they come into view. If the visitor
 * prefers reduced motion, or the browser cannot observe scrolling, `anim` is never set and everything is
 * simply there. A timer reveals anything still hidden, so content can never get stuck invisible.
 */
function useLandingMotion(root: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el || !enabled) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".reveal"));
    const mountedAt = performance.now();
    const show = (n: HTMLElement) => {
      // anything already on screen when the page opens waits for the hero sequence to finish (about 2 s)
      const wait = Math.max(0, 1700 - (performance.now() - mountedAt));
      setTimeout(() => {
        n.classList.add("in");
        // once it has arrived, hand its transitions back (hover lifts must be quick, not 0.6 s)
        setTimeout(() => n.classList.add("done"), 1100);
      }, wait);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            show(e.target as HTMLElement);
            io.unobserve(e.target);
          }
      },
      { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
    );
    for (const n of items) io.observe(n);
    const safety = setTimeout(() => {
      for (const n of items) n.classList.add("in");
    }, 12_000);
    return () => {
      io.disconnect();
      clearTimeout(safety);
    };
  }, [root, enabled]);
  return scrolled;
}

/** The public page: what this is, how it works, and what is and is not proven yet. */
export function Landing() {
  const root = useRef<HTMLElement>(null);
  const animate =
    typeof window !== "undefined" && "IntersectionObserver" in window && !reducedMotion();
  const scrolled = useLandingMotion(root, animate);
  return (
    <>
      <header className={`bar${scrolled ? " scrolled" : ""}`}>
        <a className="brand" href="#/">
          <Wordmark />
        </a>
        <nav aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#why">What is different</a>
          <a href="#status">Status</a>
        </nav>
        {TESTNET && <span className="pill pill-accent">Testnet demo</span>}
        <span className="grow" />
        <a className="btn shine" href="#/signin">
          Launch the app
        </a>
      </header>
      <main ref={root} className={`wrap landing hero-anim${animate ? " anim" : ""}`}>
        <section className="hero">
          <FilmArt animate />
          <div className="label rise" style={{ ["--d" as string]: "0s" }}>
            Open source · built on Nostr
          </div>
          <h1>
            <Words text="Stories anyone can fork. Episodes that pay everyone who made them." />
          </h1>
          <p
            className="muted rise"
            style={{ maxWidth: "38rem", fontSize: "1.1rem", ["--d" as string]: "0.95s" }}
          >
            Reelstr is a micro-drama platform with no owner. Short AI-made scenes branch like code,
            curators cut the best branches into episodes, and viewers pay per episode in sats. The
            revenue split is written into the episode, where anyone can check it.
          </p>
          <div
            className="row tight rise"
            style={{ marginTop: "1.4rem", ["--d" as string]: "1.1s" }}
          >
            <a className="btn shine" href="#/signin">
              Launch the app
            </a>
            <a className="btn btn-plain" href="#how">
              How it works
            </a>
          </div>
          <div className="row tight" style={{ marginTop: "1.4rem", gap: "0.5rem" }}>
            {[
              "Free to watch the first episodes",
              "Pay in sats",
              "Splits are public",
              ...(TESTNET ? ["Free test sats from a faucet"] : []),
            ].map((t, i) => (
              <span
                key={t}
                className="pill rise"
                style={{ ["--d" as string]: `${1.3 + i * 0.1}s` }}
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        <div id="how" className="label reveal" style={{ margin: "2rem 0 0.7rem" }}>
          How it works
        </div>
        <div className="grid grid-3 steps">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={`cover step-card reveal ${s.tone}`}
              style={{ ["--i" as string]: i * 1.5 }}
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

        <div id="why" className="label reveal" style={{ margin: "2rem 0 0.7rem" }}>
          What is different
        </div>
        <div className="grid grid-3">
          {FEATURES.map(([t, b], i) => (
            <div key={t} className="card reveal" style={{ margin: 0, ["--i" as string]: i % 3 }}>
              <h3>{t}</h3>
              <p className="muted" style={{ marginBottom: 0 }}>
                {b}
              </p>
            </div>
          ))}
        </div>

        <div id="status" className="label reveal" style={{ margin: "2rem 0 0.7rem" }}>
          Status
        </div>
        <div className="card card-soft reveal">
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

        <section className="hero cta reveal" style={{ marginTop: "2rem" }}>
          <FilmArt animate />
          <h1 style={{ marginBottom: "0.75rem" }}>Watch one, or make one.</h1>
          <a className="btn shine" href="#/signin">
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
