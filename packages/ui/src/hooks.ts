import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/** Tiny hash router: "#/story/abc" -> ["story", "abc"]. */
// Only "#/…" is a screen. A plain "#section" is an in-page link, which the browser scrolls to by itself
// and the router must leave alone (otherwise "#how" is read as a screen called "how").
const isRoute = (h: string) => h === "" || h === "#" || h.startsWith("#/");
const readHash = () =>
  isRoute(window.location.hash) ? window.location.hash.replace(/^#\/?/, "") : null;
const parse = (h: string) => h.split("/").filter(Boolean).map(decodeURIComponent);

/**
 * One router for the whole page, so a route change is a single event we can animate.
 * `history` is our own record of where we have been: a hash change does not say whether it was a click
 * or the browser's back button, but landing on the entry before the current one means "back".
 * The change is wrapped in a view transition (where the browser has them) and tagged with a direction
 * on <html data-nav>, which the stylesheet turns into a slide one way or the other.
 */
let current = typeof window === "undefined" ? "" : (readHash() ?? "");
const history: string[] = [current];
const scrollAt = new Map<string, number>();
const subscribers = new Set<() => void>();

function onHashChange() {
  const next = readHash();
  if (next === null || next === current) return;
  const back = history.length > 1 && history[history.length - 2] === next;
  if (back) history.pop();
  else history.push(next);
  scrollAt.set(current, window.scrollY);
  current = next;
  const commit = () => {
    for (const f of subscribers) f();
    // forward starts at the top; back returns to where you were (as far as the content has loaded)
    window.scrollTo(0, back ? (scrollAt.get(next) ?? 0) : 0);
  };
  document.documentElement.dataset.nav = back ? "back" : "forward";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
  const start = (document as Document & { startViewTransition?: (cb: () => void) => VT })
    .startViewTransition;
  if (start && !reduced) {
    const vt = start.call(document, () => flushSync(commit));
    // a navigation during another one's animation skips it: the page still updates, but the browser
    // rejects the skipped transition's promises, which would surface as an unhandled error
    for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p.catch(() => {});
  } else commit();
}
if (typeof window !== "undefined") window.addEventListener("hashchange", onHashChange);

const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => {
    subscribers.delete(f);
  };
};

export function useRoute(): string[] {
  const h = useSyncExternalStore(
    subscribe,
    () => current,
    () => "",
  );
  return useMemo(() => parse(h), [h]);
}
/** Whether the last navigation was back (for components that animate themselves). */
export const lastNavigation = () => document.documentElement.dataset.nav ?? "forward";
export const go = (...parts: string[]) => {
  window.location.hash = `/${parts.map(encodeURIComponent).join("/")}`;
};

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data?: T; error?: string; loading: boolean; reload: () => void } {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are supplied by the caller
  useEffect(() => {
    let live = true;
    set((p) => ({ ...p, loading: true }));
    fn().then(
      (data) => live && set({ data, loading: false }),
      (e: Error) => live && set({ error: e.message, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, n]);
  return { ...s, reload: () => setN((x) => x + 1) };
}
