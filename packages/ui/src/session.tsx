import { ReelstrClient } from "@reelstr/app-core";
import { LocalSigner, Nip07Signer, Nip46Signer, type Signer } from "@reelstr/nostr";
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
      : /nsec|bech32|invalid/i.test(m)
        ? "That does not look like a valid secret key. It should start with nsec1."
        : m;

/** FE-1: the three sign-in paths. No private key is ever sent anywhere. */
export function LoginGate({ children, title }: { children: ReactNode; title: string }) {
  const { client, login } = useSession();
  const [err, setErr] = useState("");
  const [bunker, setBunker] = useState("");
  const [fresh, setFresh] = useState<LocalSigner | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [nsec, setNsec] = useState("");

  if (client) return <>{children}</>;
  const run = (f: () => Promise<void>) => f().catch((e: Error) => setErr(e.message));
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
        <FilmArt />
      </div>
      <div className="gate-forms">
        <section>
          <h2>Browser extension</h2>
          <button type="button" onClick={() => run(async () => login(new Nip07Signer()))}>
            Use NIP-07 extension
          </button>
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
            onClick={() => run(async () => login(await Nip46Signer.connect(bunker)))}
          >
            Connect (NIP-46)
          </button>
        </section>
        <section>
          <h2>New key</h2>
          {!fresh ? (
            <button type="button" onClick={() => setFresh(LocalSigner.generate())}>
              Generate a key
            </button>
          ) : (
            <>
              <p>Save this secret key somewhere safe. If you lose it, your account is gone.</p>
              <code className="nsec">{fresh.backup()}</code>
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
                  run(async () => {
                    try {
                      localStorage.setItem(NSEC_KEY, fresh.backup());
                    } catch {}
                    await login(fresh);
                  })
                }
              >
                Continue
              </button>
            </>
          )}
        </section>
        <section>
          <h2>Existing key</h2>
          <input
            type="password"
            placeholder="nsec1…"
            value={nsec}
            onChange={(e) => setNsec(e.target.value)}
          />
          <button
            type="button"
            disabled={!nsec}
            onClick={() => run(async () => login(LocalSigner.fromNsec(nsec)))}
          >
            Use this key
          </button>
        </section>
        {err && (
          <div className="alert" role="alert">
            <strong>Could not sign in</strong>
            {friendly(err)}
          </div>
        )}
      </div>
    </main>
  );
}
