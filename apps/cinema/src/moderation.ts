/** Per-viewer moderation state, kept only in this browser: reporting hides an item for you at once (FE-11). */
const HIDE = "reelstr.hidden";
const REVEAL = "reelstr.revealed";

const read = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const write = (k: string, v: string[]) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const hiddenIds = (): Set<string> => new Set(read(HIDE));
export const hide = (id: string) => write(HIDE, [...new Set([...read(HIDE), id])]);
export const unhide = (id: string) =>
  write(
    HIDE,
    read(HIDE).filter((x) => x !== id),
  );
export const isRevealed = (id: string) => read(REVEAL).includes(id);
export const reveal = (id: string) => write(REVEAL, [...new Set([...read(REVEAL), id])]);
