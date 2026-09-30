import { go, HlsPlayer, useAsync, useSession } from "@reelstr/ui";
import { useRef } from "react";
import { Credits, type CutRow, type SeriesRow } from "./Home";
import { loadProgress, saveProgress } from "./progress";

/** FE-7: full-screen vertical player, auto-next, resume. */
export function Watch({ cutId }: { cutId: string }) {
  const { client } = useSession();
  const api = (client as NonNullable<typeof client>).api.bind(client);
  const cut = useAsync(async () => {
    const all = await api<CutRow[]>("/cuts");
    const c = all.find((x) => x.id === cutId);
    if (!c) throw new Error("episode not found");
    const series = (await api<SeriesRow[]>("/series")).find(
      (s) => s.curator === c.curator && s.slug === c.series_slug,
    );
    const siblings = all
      .filter((x) => x.curator === c.curator && x.series_slug === c.series_slug)
      .sort((a, b) => a.episode - b.episode);
    return { c, series, next: siblings.find((x) => x.episode > c.episode) };
  }, [cutId]);
  const last = useRef(0);
  const start = loadProgress()[cutId]?.t ?? 0;
  const c = cut.data?.c;
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "8px 12px" }}>
      <p>
        <a href={cut.data?.series ? `#/series/${encodeURIComponent(cut.data.series.coord)}` : "#/"}>
          ← {cut.data?.series?.title ?? "Back"}
        </a>
      </p>
      {cut.error && <p className="error">{cut.error}</p>}
      {c && !c.hls_url && <p className="muted">This episode has no rendered video yet.</p>}
      {c?.hls_url && (
        <HlsPlayer
          key={c.id}
          src={c.hls_url}
          startAt={start > 0 && start < Number(c.duration) - 2 ? start : 0}
          onProgress={(t) => {
            if (t - last.current > 2) {
              last.current = t;
              saveProgress(c.id, t, {
                series: c.series_slug,
                title: `${c.series_slug} · Ep ${c.episode}`,
              });
            }
          }}
          onEnded={() => {
            saveProgress(c.id, 0);
            if (cut.data?.next) go("watch", cut.data.next.id);
          }}
        />
      )}
      {c && (
        <h2>
          Ep {c.episode} · {c.title}
        </h2>
      )}
      {cut.data?.next && (
        <p className="muted">Next: Ep {cut.data.next.episode} plays automatically.</p>
      )}
      {c && <Credits cutId={c.id} priceSats={c.price} />}
    </div>
  );
}
