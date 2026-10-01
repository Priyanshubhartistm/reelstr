import { describe, expect, test } from "bun:test";
import { retry } from "../src";

describe("retry", () => {
  test("returns once the dependency comes up, and says it is waiting", async () => {
    let n = 0;
    const logs: string[] = [];
    const v = await retry(
      "db",
      async () => {
        if (++n < 3) throw new Error("ECONNREFUSED\nstack…");
        return "up";
      },
      { delayMs: 1, log: (s) => logs.push(s) },
    );
    expect(v).toBe("up");
    expect(n).toBe(3);
    expect(logs).toEqual([
      "db not ready (ECONNREFUSED), retry 1/30",
      "db not ready (ECONNREFUSED), retry 2/30",
    ]);
  });

  test("gives up with the last error after the allowed tries", async () => {
    let n = 0;
    await expect(
      retry("x", async () => Promise.reject(new Error(`no ${++n}`)), {
        tries: 3,
        delayMs: 1,
        log: () => {},
      }),
    ).rejects.toThrow("no 3");
    expect(n).toBe(3);
  });
});
