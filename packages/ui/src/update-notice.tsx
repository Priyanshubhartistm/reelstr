import { useEffect, useState } from "react";

/**
 * A tab that stays open keeps running the code it loaded. When a newer version has been deployed,
 * say so and offer the reload, instead of leaving people on a stale screen that no longer matches.
 * Checked when the tab becomes visible again and every five minutes: the page's fingerprinted script
 * name is compared with the one the server serves now.
 */
export function UpdateNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = Array.from(document.scripts)
      .map((s) => s.src)
      .find((src) => /\/assets\/index-[\w-]+\.js/.test(src));
    if (!mine) return; // dev server: nothing is fingerprinted
    const check = async () => {
      try {
        const html = await (
          await fetch(`${location.pathname}?v=${Date.now()}`, { cache: "no-store" })
        ).text();
        const now = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
        if (now && !mine.endsWith(now)) setStale(true);
      } catch {}
    };
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(check, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="update" role="status">
      A new version of Reelstr is available.
      <button type="button" className="sm" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
