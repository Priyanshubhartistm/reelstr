import { ReelstrClient } from "@reelstr/app-core";
import { LocalSigner, Nip07Signer, Nip46Signer, parseSecretKey, type Signer } from "@reelstr/nostr";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Endpoints, loadEndpoints, saveEndpoints } from "./config";
import { BackLink, FilmArt, Wordmark } from "./shell";

interface Session {
  client: ReelstrClient | null;
  pubkey: string | null;
  endpoints: Endpoints;
  setEndpoints: (e: Endpoints) => void;
  login: (s: Signer) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
};

const NSEC_KEY = "reelstr.localkey";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [endpoints, setEp] = useState<Endpoints>(loadEndpoints);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);

  const login = useCallback(async (s: Signer) => {
    setPubkey(await s.getPublicKey());
    setSigner(s);
  }, []);
  const logout = useCallback(() => {
    setSigner(null);
    setPubkey(null);
    try {
      localStorage.removeItem(NSEC_KEY);
    } catch {}
  }, []);

  // restore a previously generated local key (it is the user's; the backup prompt already ran)
  useEffect(() => {
    try {
      const n = localStorage.getItem(NSEC_KEY);
      if (n) void login(LocalSigner.fromNsec(n));
    } catch {}
  }, [login]);

  const client = useMemo(
    () => (signer ? new ReelstrClient({ ...endpoints, signer }) : null),
    [signer, endpoints],
  );
  const value: Session = {
    client,
    pubkey,
    endpoints,
    login,
    logout,
    setEndpoints: (e) => {
      saveEndpoints(e);
      setEp(e);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Say what to do, not what the browser threw. */
const friendly = (m: string) =>
  /window\.nostr/.test(m)
    ? "No Nostr extension was found in this browser. Install one such as nos2x or Alby, or use a remote signer or a key instead."
    : /invalid bunker|bunker/i.test(m)
      ? `The remote signer did not accept the connection (${m}). Check the bunker:// address and that the signer is online.`
      : m;

/** FE-1: the three sign-in paths. No private key is ever sent anywhere. */
export function LoginGate({ children, title }: { children: ReactNode; title: string }) {
  const { client, login } = useSession();
  // which card the problem came from, so the message appears next to the thing that failed
  const [err, setErr] = useState<{ where: string; msg: string } | null>(null);
  const [bunker, setBunker] = useState("");
  const [fresh, setFresh] = useState<LocalSigner | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [nsec, setNsec] = useState("");
  // an extension injects window.nostr a moment after the page loads, so look for a few seconds
  const [hasExt, setHasExt] = useState(false);
  useEffect(() => {
    const look = () =>
      setHasExt(typeof (window as unknown as { nostr?: unknown }).nostr === "object");
    look();
    const timers = [300, 1000, 2500].map((ms) => setTimeout(look, ms));
    window.addEventListener("focus", look);
    return () => {
      for (const t of timers) clearTimeout(t);
      window.removeEventListener("focus", look);
    };
  }, []);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(false);

  if (client) return <>{children}</>;
  const run = (where: string, f: () => Promise<void>) => {
    setErr(null);
    return f().catch((e: Error) => setErr({ where, msg: e.message }));
  };
  const copyKey = async (nsecText: string) => {
    try {
      await navigator.clipboard.writeText(nsecText);
    } catch {
      // no clipboard permission: select the text so the person can press copy themselves
      const el = document.querySelector(".nsec");
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(r);
      }
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const downloadKey = (nsecText: string) => {
    const blob = new Blob(
      [
        `Reelstr secret key\n\n${nsecText}\n\nAnyone with this key controls your account. Keep it private. If you lose it, the account cannot be recovered.\n`,
      ],
      { type: "text/plain" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reelstr-secret-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const problem = (where: string) =>
    err?.where === where && (
      <div
        className="alert"
        role="alert"
        ref={(el) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" })}
      >
        <strong>Could not sign in</strong>
        {friendly(err.msg)}
      </div>
    );
  return (
    <main className="gate">
      <div className="gate-top">
        <BackLink href="#/">Back</BackLink>
      </div>
      <div className="gate-hero hero">
        <a className="brand" href="#/" style={{ color: "var(--hero-fg)" }}>
          <Wordmark />
        </a>
        <h1>{title}</h1>
        <p className="muted">
          Sign in with a Nostr key. Your private key never leaves your signer.
        </p>
        <ul className="points">
          <li>No account to create and no email to give.</li>
          <li>Every split and every payout is public.</li>
          <li>Pay per episode in sats, or watch the free ones.</li>
        </ul>
        <FilmArt animate />
      </div>
      <div className="gate-forms">
        <section>
          <h2>New key · easiest</h2>
          {!fresh ? (
            <button type="button" onClick={() => setFresh(LocalSigner.generate())}>
              Generate a key
            </button>
          ) : (
            <>
              <p>Save this secret key somewhere safe. If you lose it, your account is gone.</p>
              <code className="nsec">{fresh.backup()}</code>
              <div className="row tight" style={{ gap: "0.5rem" }}>
                <button type="button" className="ghost sm" onClick={() => copyKey(fresh.backup())}>
                  {copied ? "Copied" : "Copy key"}
                </button>
                <button
                  type="button"
                  className="ghost sm"
                  onClick={() => downloadKey(fresh.backup())}
                >
                  Download backup
                </button>
                <span className="sr" role="status">
                  {copied ? "Key copied to the clipboard" : ""}
                </span>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                I saved my key
              </label>
              <button
                type="button"
                disabled={!confirmed}
                onClick={() =>
                  run("new", async () => {
                    try {
                      localStorage.setItem(NSEC_KEY, fresh.backup());
                    } catch {}
                    await login(fresh);
                  })
                }
              >
                Continue
              </button>
              {problem("new")}
            </>
          )}
        </section>
        <section>
          <h2>Browser extension</h2>
          {hasExt ? (
            <>
              <p className="muted" style={{ margin: "0 0 0.25rem" }}>
                <span className="pill pill-fair">Detected</span> Your extension keeps the key; this
                site only asks it to sign.
              </p>
              <button
                type="button"
                onClick={() => run("ext", async () => login(new Nip07Signer()))}
              >
                Use NIP-07 extension
              </button>
              {problem("ext")}
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                No extension detected in this browser. A Nostr extension such as{" "}
                <a href="https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp">
                  nos2x
                </a>{" "}
                or <a href="https://getalby.com">Alby</a> stores your key and signs for you. You do
                not need one: use a new key above.
              </p>
              <button type="button" className="ghost" disabled>
                Use NIP-07 extension
              </button>
            </>
          )}
        </section>
        <section>
          <h2>Remote signer</h2>
          <input
            placeholder="bunker://… or name@domain"
            value={bunker}
            onChange={(e) => setBunker(e.target.value)}
          />
          <button
            type="button"
            disabled={!bunker}
            onClick={() => run("bunker", async () => login(await Nip46Signer.connect(bunker)))}
          >
            Connect (NIP-46)
          </button>
          {problem("bunker")}
        </section>
        <section>
          <h2>Existing key</h2>
          <input
            type={showKey ? "text" : "password"}
            placeholder="nsec1…"
            value={nsec}
            autoComplete="off"
            spellCheck={false}
            aria-label="Secret key"
            onChange={(e) => {
              setNsec(e.target.value);
              if (err?.where === "existing") setErr(null);
            }}
          />
          <label className="check" style={{ margin: "0.5rem 0 0" }}>
            <input
              type="checkbox"
              checked={showKey}
              onChange={(e) => setShowKey(e.target.checked)}
            />
            Show what I pasted
          </label>
          <label className="check" style={{ margin: "0.25rem 0 0" }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Keep me signed in on this device
          </label>
          <button
            type="button"
            disabled={!nsec}
            onClick={() =>
              run("existing", async () => {
                const who = parseSecretKey(nsec);
                if (remember)
                  try {
                    localStorage.setItem(NSEC_KEY, who.backup());
                  } catch {}
                await login(who);
              })
            }
          >
            Use this key
          </button>
          {problem("existing")}
        </section>
      </div>
    </main>
  );
}
