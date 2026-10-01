import { useAsync, useSession } from "./index";

interface Label {
  verifier: string;
  verdict: string;
  similarity: number | null;
  exact: boolean;
  engine: string;
}
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const KEY = "reelstr.verifiers";

/** Verifier pubkeys this viewer trusts (comma-separated; localStorage wins over VITE_VERIFIERS). */
export function trustedVerifiers(): string[] {
  let raw = env.VITE_VERIFIERS ?? "";
  try {
    raw = localStorage.getItem(KEY) ?? raw;
  } catch {}
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function setTrustedVerifiers(list: string[]) {
  try {
    localStorage.setItem(KEY, list.join(","));
  } catch {}
}

/**
 * "Source Verified" only when a verifier the viewer trusts reports `verified`. It means the manifest
 * re-rendered to this clip with that engine, not who made it. Untrusted labels never earn the badge.
 */
export function SourceBadge({ sceneId }: { sceneId: string }) {
  const { client } = useSession();
  const trusted = trustedVerifiers();
  const labels = useAsync(
    () => (client as NonNullable<typeof client>).api<Label[]>(`/verifications/${sceneId}`),
    [sceneId],
  );
  const mine = (labels.data ?? []).filter((l) => trusted.includes(l.verifier));
  const best = mine.find((l) => l.verdict === "verified") ?? mine[0];
  if (best?.verdict === "verified")
    return (
      <span
        className="ok"
        title={`${best.engine}, ${best.exact ? "byte-identical" : `similarity ${best.similarity}`}`}
      >
        Source Verified
      </span>
    );
  if (best?.verdict === "mismatch")
    return <span className="error">Manifest does not reproduce this clip</span>;
  return null;
}
