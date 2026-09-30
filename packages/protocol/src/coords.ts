import { isHex64 } from "./tags";

export const coordinate = (kind: number, pubkey: string, d: string) => `${kind}:${pubkey}:${d}`;

export function parseCoordinate(
  s: string,
): { kind: number; pubkey: string; d: string } | undefined {
  const a = s.indexOf(":");
  const b = s.indexOf(":", a + 1);
  if (a < 0 || b < 0) return undefined;
  const kind = Number(s.slice(0, a));
  const pubkey = s.slice(a + 1, b);
  const d = s.slice(b + 1);
  if (!Number.isInteger(kind) || !isHex64(pubkey) || d === "") return undefined;
  return { kind, pubkey, d };
}
