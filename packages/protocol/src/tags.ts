export const HEX64 = /^[0-9a-f]{64}$/;
export const isHex64 = (s: unknown): s is string => typeof s === "string" && HEX64.test(s);

export const tag = (tags: string[][], name: string): string[] | undefined =>
  tags.find((t) => t[0] === name);

export const tagsOf = (tags: string[][], name: string): string[][] =>
  tags.filter((t) => t[0] === name);

export const tagValue = (tags: string[][], name: string): string | undefined =>
  tag(tags, name)?.[1];

/** "url https://x", "x <sha>" -> { url, x } */
export function parseImeta(t: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of t.slice(1)) {
    const i = part.indexOf(" ");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

export function imetaTag(fields: Record<string, string | number | undefined>): string[] {
  return [
    "imeta",
    ...Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k} ${v}`),
  ];
}

/** Durations/trims are decimal seconds with at most 3 decimals; convert to integer ms. */
export const toMs = (s: string | number): number => Math.round(Number(s) * 1000);
export const isSeconds = (s: string): boolean => /^\d+(\.\d{1,3})?$/.test(s);
