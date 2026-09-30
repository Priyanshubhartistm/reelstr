/** Resume positions and "continue watching" live only in this browser (a per-viewer convenience). */
const KEY = "reelstr.progress";
export type Progress = Record<string, { t: number; at: number; series?: string; title?: string }>;

export function loadProgress(): Progress {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Progress;
  } catch {
    return {};
  }
}
export function saveProgress(
  cutId: string,
  t: number,
  meta: { series?: string; title?: string } = {},
) {
  try {
    const p = loadProgress();
    p[cutId] = { ...p[cutId], ...meta, t, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
