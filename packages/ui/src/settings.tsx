import { parsePubkey } from "@reelstr/nostr";
import { useState } from "react";
import { defaultEndpoints, type Endpoints } from "./config";
import { useSession } from "./session";
import { setTrustedVerifiers, trustedVerifiers } from "./verified";

/** Settings: which verifiers earn the "Source Verified" badge for this viewer, and where the services are. */
export function Settings() {
  const { endpoints, setEndpoints } = useSession();
  const [trusted, setTrusted] = useState(trustedVerifiers);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");
  const [ep, setEp] = useState({ ...endpoints, relays: endpoints.relays.join(",") });
  const [saved, setSaved] = useState(false);

  const commit = (list: string[]) => {
    setTrusted(list);
    setTrustedVerifiers(list);
  };
  const field = (k: keyof Omit<Endpoints, "powBits" | "mirrors">, label: string) => (
    <>
      <label htmlFor={`ep-${k}`}>{label}</label>
      <input
        id={`ep-${k}`}
        value={(ep[k] as string | undefined) ?? ""}
        onChange={(e) => setEp({ ...ep, [k]: e.target.value })}
      />
    </>
  );

  return (
    <>
      <h1>Settings</h1>
      <h2>Trusted verifiers</h2>
      <div className="card">
        <p className="muted">
          A scene gets "Source Verified" only when a verifier you trust re-rendered it from its
          manifest and got the same clip. Anyone can publish a verdict; you choose whose count.
        </p>
        {trusted.length === 0 && <p className="muted">No verifiers trusted yet.</p>}
        {trusted.map((k) => (
          <div key={k} className="row" style={{ alignItems: "center" }}>
            <code title={k}>{`${k.slice(0, 12)}…${k.slice(-6)}`}</code>
            <button
              type="button"
              className="ghost"
              onClick={() => commit(trusted.filter((x) => x !== k))}
            >
              Remove
            </button>
          </div>
        ))}
        <label htmlFor="v-add">Add a verifier (npub or hex public key)</label>
        <div className="row">
          <input id="v-add" value={add} onChange={(e) => setAdd(e.target.value)} />
          <button
            type="button"
            onClick={() => {
              const k = parsePubkey(add);
              if (!k) return setErr("That is not a valid public key (npub… or 64 hex characters).");
              setErr("");
              setAdd("");
              if (!trusted.includes(k)) commit([...trusted, k]);
            }}
          >
            Trust
          </button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>

      <h2>Services</h2>
      <div className="card">
        <p className="muted">
          Where this app talks to. Changing these reloads your session's client.
        </p>
        <label htmlFor="ep-relays">Relays (comma separated)</label>
        <input
          id="ep-relays"
          value={ep.relays}
          onChange={(e) => setEp({ ...ep, relays: e.target.value })}
        />
        {field("blossom", "Blossom server")}
        {field("mediaUrl", "Media service")}
        {field("indexerUrl", "Indexer")}
        {field("keysUrl", "Key server")}
        <p>
          <button
            type="button"
            onClick={() => {
              setEndpoints({
                ...endpoints,
                ...ep,
                relays: ep.relays
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              });
              setSaved(true);
            }}
          >
            Save
          </button>{" "}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const d = defaultEndpoints();
              setEndpoints(d);
              setEp({ ...d, relays: d.relays.join(",") });
              setSaved(true);
            }}
          >
            Reset to defaults
          </button>
        </p>
        {saved && <p className="muted">Saved.</p>}
      </div>
    </>
  );
}
