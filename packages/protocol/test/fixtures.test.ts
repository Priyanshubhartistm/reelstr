import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blobMatches, sha256Hex, validateEvent } from "../src";

const dir = (d: string) => {
  const p = join(import.meta.dir, "..", "fixtures", d);
  return readdirSync(p)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      f,
      ...(JSON.parse(readFileSync(join(p, f), "utf8")) as { event: never; expect: string[] }),
    }));
};

describe("fixtures (NP-2)", () => {
  const valid = dir("valid");
  const invalid = dir("invalid");
  test("there are fixtures", () => {
    expect(valid.length).toBeGreaterThanOrEqual(8);
    expect(invalid.length).toBeGreaterThanOrEqual(10);
  });
  for (const { f, event } of valid)
    test(`valid ${f}`, () => {
      const r = validateEvent(event, { verifySig: true });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    });
  for (const { f, event, expect: want } of invalid)
    test(`invalid ${f} is rejected with a reason`, () => {
      const r = validateEvent(event, { verifySig: true });
      expect(r.ok).toBe(false);
      for (const w of want) expect(r.errors.join("\n")).toContain(w);
    });
  test("a tampered event fails signature verification", () => {
    const { event } = valid[0] as { event: { content: string } };
    const r = validateEvent({ ...event, content: `${event.content}!` } as never, {
      verifySig: true,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("signature");
  });
});

describe("blob hash", () => {
  test("rejects mismatched bytes", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(blobMatches(bytes, sha256Hex(bytes))).toBe(true);
    expect(blobMatches(new TextEncoder().encode("hellO"), sha256Hex(bytes))).toBe(false);
  });
});
