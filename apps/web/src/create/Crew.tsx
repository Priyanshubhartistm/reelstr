import { CrewRoom, releaseDraft } from "@reelstr/app-core";
import type { NostrEvent } from "@reelstr/nostr";
import { parseScene } from "@reelstr/protocol";
import { useSession } from "@reelstr/ui";
import { useCallback, useEffect, useRef, useState } from "react";

const get = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const short = (pk: string) => `${pk.slice(0, 8)}…`;

/** FE-12: a closed production room. Drafts and chat live on the crew relay only until released. */
export function Crew() {
  const { client, pubkey } = useSession();
  const c = client as NonNullable<typeof client>;
  const [url, setUrl] = useState(
    get("reelstr.crewRelay") || env.VITE_CREW_RELAY || "ws://127.0.0.1:3335",
  );
  const [group, setGroup] = useState(get("reelstr.crewGroup"));
  const [room, setRoom] = useState<CrewRoom | null>(null);
  const [chat, setChat] = useState<{ id: string; from: string; text: string }[]>([]);
  const [drafts, setDrafts] = useState<NostrEvent[]>([]);
  const [text, setText] = useState("");
  const [invite, setInvite] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const stop = useRef<(() => void) | null>(null);

  const load = useCallback(async (r: CrewRoom) => {
    try {
      setChat(await r.messages());
      setDrafts(await r.drafts());
    } catch {
      // the room was closed while a refresh was in flight
    }
  }, []);

  useEffect(
    () => () => {
      stop.current?.();
      room?.close();
    },
    [room],
  );

  async function open(create: boolean) {
    setErr("");
    try {
      set("reelstr.crewRelay", url);
      set("reelstr.crewGroup", group);
      const r = await CrewRoom.join(url, group, c.cfg.signer);
      if (create) await r.create(group);
      await load(r);
      stop.current = r.watch(() => void load(r));
      setRoom(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const run = async (f: () => Promise<unknown>, ok = "") => {
    setErr("");
    setMsg("");
    try {
      await f();
      if (ok) setMsg(ok);
      if (room) await load(room);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!room)
    return (
      <>
        <section className="hero">
          <div className="label">Crew rooms</div>
          <h1>Work on scenes in private</h1>
          <p className="muted" style={{ maxWidth: "38rem" }}>
            Work on scenes privately with your crew. Nothing in a room is visible on public relays
            until someone releases it.
          </p>
        </section>
        <div className="cols">
          <div className="card">
            <h3>Open or create a room</h3>
            <label htmlFor="cr-url">Crew relay</label>
            <input id="cr-url" value={url} onChange={(e) => setUrl(e.target.value)} />
            <label htmlFor="cr-group">Room id</label>
            <input
              id="cr-group"
              placeholder="vault-crew"
              value={group}
              onChange={(e) => setGroup(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            />
            <p>
              <button type="button" disabled={!group} onClick={() => open(true)}>
                Create room
              </button>{" "}
              <button type="button" className="ghost" disabled={!group} onClick={() => open(false)}>
                Open room
              </button>
            </p>
            {err && <p className="error">{err}</p>}
          </div>
          <div className="card card-soft">
            <h3>How a room works</h3>
            <ol className="steps">
              <li>
                <b>Create a room</b> on a crew relay. Only people you invite can read it.
              </li>
              <li>
                <b>Post drafts</b> from the scene composer with "Post as crew draft", and chat about
                them.
              </li>
              <li>
                <b>Release</b> the ones you want. The author publishes a clean copy to the public
                relays; the room never does.
              </li>
            </ol>
          </div>
        </div>
      </>
    );

  return (
    <>
      <p style={{ margin: "0 0 1rem" }}>
        <button
          type="button"
          className="back"
          onClick={() => {
            room.close();
            setRoom(null);
          }}
        >
          <span aria-hidden="true">←</span>Rooms
        </button>
      </p>
      <section className="hero">
        <div className="label">Private room</div>
        <h1>{group}</h1>
        <p className="muted">
          Only invited members can read this. Nothing here is public until released.
        </p>
      </section>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 2 }}>
          <h2 style={{ marginTop: 0 }}>Chat</h2>
          <div className="card" data-testid="chat" style={{ maxHeight: 320, overflow: "auto" }}>
            {chat.length === 0 && <p className="muted">No messages yet.</p>}
            {chat.map((m) => (
              <div key={m.id} className={`bubble ${m.from === pubkey ? "mine" : ""}`}>
                <span className="label" title={m.from}>
                  {m.from === pubkey ? "you" : short(m.from)}
                </span>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                text &&
                run(async () => {
                  await room.say(text);
                  setText("");
                })
              }
            />
            <button
              type="button"
              disabled={!text}
              onClick={() =>
                run(async () => {
                  await room.say(text);
                  setText("");
                })
              }
            >
              Send
            </button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0 }}>Crew</h2>
          <div className="card">
            <label htmlFor="cr-inv">Invite (pubkey, hex)</label>
            <input id="cr-inv" value={invite} onChange={(e) => setInvite(e.target.value.trim())} />
            <p>
              <button
                type="button"
                className="ghost"
                disabled={!/^[0-9a-f]{64}$/.test(invite)}
                onClick={() =>
                  run(async () => {
                    await room.invite(invite);
                    setInvite("");
                  }, "Invited.")
                }
              >
                Add to crew
              </button>
            </p>
            <p className="muted">
              Your pubkey: <code title={pubkey ?? ""}>{short(pubkey ?? "")}</code>
            </p>
          </div>
        </div>
      </div>
      <h2>Drafts</h2>
      <p className="muted">
        Post drafts from the scene composer with "Post as crew draft". Release publishes a clean
        copy to the public relays.
      </p>
      <div className="card" data-testid="drafts">
        {drafts.length === 0 && <p className="muted">No drafts.</p>}
        {drafts.map((d) => {
          const s = parseScene(d);
          return (
            <div key={d.id} className="row" style={{ alignItems: "center", padding: ".3rem 0" }}>
              <span>
                <strong>{s.title}</strong>{" "}
                <span className="muted">
                  {s.duration.toFixed(1)} s · {short(d.pubkey)}
                </span>
              </span>
              {d.pubkey === pubkey ? (
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      await releaseDraft(d as never, {
                        signer: c.cfg.signer,
                        powBits: await c.requiredPow(),
                        publish: (ev) => c.pool.publish(ev, c.cfg.relays),
                      });
                    }, `Released "${s.title}".`)
                  }
                >
                  Release publicly
                </button>
              ) : (
                <span className="pill">only the author can release</span>
              )}
            </div>
          );
        })}
      </div>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="error">{err}</p>}
    </>
  );
}
