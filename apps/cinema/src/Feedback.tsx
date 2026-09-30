import { buildRating, buildReport, type ReportReason } from "@reelstr/protocol";
import { useAsync, useSession } from "@reelstr/ui";
import { useState } from "react";
import { hide } from "./moderation";

let starGroup = 0;

/** Read-only stars, or (with `onPick`) a proper radio group so keyboards and screen readers work. */
export function Stars({
  value,
  onPick,
  label,
}: {
  value: number;
  onPick?: (n: number) => void;
  label?: string;
}) {
  const [group] = useState(() => `stars-${++starGroup}`);
  if (!onPick)
    return (
      <span
        role="img"
        aria-label={label ?? `${value} out of 5 stars`}
        style={{ whiteSpace: "nowrap" }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            aria-hidden="true"
            style={{ color: n <= Math.round(value) ? "var(--accent)" : "var(--muted)" }}
          >
            {n <= Math.round(value) ? "★" : "☆"}
          </span>
        ))}
      </span>
    );
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, whiteSpace: "nowrap" }}>
      <legend className="sr">{label ?? "Rating"}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          style={{
            display: "inline-block",
            margin: 0,
            cursor: "pointer",
            color: n <= value ? "var(--accent)" : "var(--muted)",
            fontSize: "1.3rem",
          }}
        >
          <input
            className="sr"
            type="radio"
            name={group}
            checked={n === value}
            onChange={() => onPick(n)}
          />
          <span aria-hidden="true">{n <= value ? "★" : "☆"}</span>
          <span className="sr">{`${n} star${n > 1 ? "s" : ""}`}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** FE-13: average and count, plus rate-and-review for this viewer. */
export function Ratings({ cutId, cutCoord }: { cutId: string; cutCoord: string }) {
  const { client } = useSession();
  const c = client as NonNullable<typeof client>;
  const sum = useAsync(
    async () => (await c.api<{ count: number; average: number }[]>(`/ratings?cuts=${cutId}`))[0],
    [cutId],
  );
  const list = useAsync(
    () => c.api<{ rater: string; stars: number; review: string }[]>(`/ratings/${cutId}`),
    [cutId],
  );
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    try {
      const ev = await c.cfg.signer.signEvent(buildRating({ stars, cutId, cutCoord, review }));
      await c.pool.publish(ev, c.cfg.relays);
      setMsg("Thanks, your rating is published.");
      // the indexer learns of the rating over a relay subscription, so refresh a few times
      for (const ms of [600, 1500, 3500]) {
        setTimeout(() => {
          sum.reload();
          list.reload();
        }, ms);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <>
      <h2>Ratings</h2>
      <p data-testid="rating-summary">
        {sum.data ? (
          <>
            <Stars value={sum.data.average} /> {sum.data.average.toFixed(1)} from {sum.data.count}{" "}
            rating{sum.data.count === 1 ? "" : "s"}
          </>
        ) : (
          <span className="muted">No ratings yet.</span>
        )}
      </p>
      <div className="card">
        <Stars value={stars} onPick={setStars} label="Your rating" />
        <label htmlFor="rv">Review (optional)</label>
        <textarea
          id="rv"
          rows={2}
          maxLength={2000}
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />
        <p>
          <button type="button" disabled={stars < 1} onClick={submit}>
            Rate this episode
          </button>
        </p>
        {msg && <p className="ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </div>
      {list.data
        ?.filter((r) => r.review)
        .map((r) => (
          <p key={r.rater} className="muted">
            <Stars value={r.stars} /> {r.review}{" "}
            <span title={r.rater}>· {r.rater.slice(0, 6)}…</span>
          </p>
        ))}
    </>
  );
}

const REASONS: ReportReason[] = ["spam", "illegal", "nudity", "impersonation", "malware", "other"];

/** FE-11: report (NIP-56). The item is hidden for this viewer immediately. */
export function ReportButton({
  eventId,
  author,
  onHidden,
}: {
  eventId: string;
  author: string;
  onHidden: () => void;
}) {
  const { client } = useSession();
  const c = client as NonNullable<typeof client>;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [err, setErr] = useState("");
  async function send() {
    setErr("");
    hide(eventId); // local first: hidden even if the relay is unreachable
    onHidden();
    try {
      const ev = await c.cfg.signer.signEvent(
        buildReport({ eventId, authorPubkey: author, reason }),
      );
      await c.pool.publish(ev, c.cfg.relays);
    } catch (e) {
      setErr(`Hidden for you, but the report could not be sent: ${(e as Error).message}`);
    }
  }
  return (
    <>
      <button type="button" className="ghost" onClick={() => setOpen(!open)}>
        Report
      </button>
      {open && (
        <div className="card" style={{ marginTop: 8 }} role="dialog" aria-label="Report episode">
          <label htmlFor="rp">Reason</label>
          <select
            id="rp"
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
          >
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <p>
            <button type="button" onClick={send}>
              Report and hide
            </button>
          </p>
          {err && <p className="error">{err}</p>}
        </div>
      )}
    </>
  );
}
