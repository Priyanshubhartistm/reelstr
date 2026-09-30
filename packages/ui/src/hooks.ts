import { useEffect, useState } from "react";

/** Tiny hash router: "#/story/abc" -> ["story", "abc"]. */
const readRoute = () =>
  window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

export function useRoute(): string[] {
  const [r, setR] = useState(readRoute);
  useEffect(() => {
    const f = () => setR(readRoute());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}
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
