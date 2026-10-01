import { afterEach, describe, expect, test } from "bun:test";
import { fetchVerified, installUrlRewrite, internalUrl, rewriteHosts } from "../src";

const sha = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
afterEach(() => {
  delete process.env.BLOSSOM_REWRITE;
});

describe("BLOSSOM_REWRITE (public blob URLs reached through internal addresses)", () => {
  test("unset: nothing changes", () => {
    expect(internalUrl("http://localhost:3100/abc.mp4")).toBe("http://localhost:3100/abc.mp4");
    expect(rewriteHosts()).toEqual([]);
  });

  test("maps matching origins only, keeps path and query", () => {
    process.env.BLOSSOM_REWRITE =
      "http://localhost:3100=http://blossom:3100/, https://cdn.example=http://b2:9";
    expect(internalUrl("http://localhost:3100/abc.mp4?x=1")).toBe(
      "http://blossom:3100/abc.mp4?x=1",
    );
    expect(internalUrl("https://cdn.example/h")).toBe("http://b2:9/h");
    // a lookalike host is not rewritten
    expect(internalUrl("http://localhost:31001/abc")).toBe("http://localhost:31001/abc");
    expect(internalUrl("http://other/abc")).toBe("http://other/abc");
    expect(rewriteHosts().sort()).toEqual(["cdn.example", "localhost:3100"]);
  });

  test("fetchVerified fetches the internal address but still verifies the hash", async () => {
    const body = new TextEncoder().encode("blob");
    const seen: string[] = [];
    process.env.BLOSSOM_REWRITE = "http://pub.example=http://internal:3100";
    const got = await fetchVerified(["http://pub.example/x"], sha(body), async (u) => {
      seen.push(String(u));
      return new Response(body);
    });
    expect(seen).toEqual(["http://internal:3100/x"]);
    expect(got.url).toBe("http://pub.example/x");
    await expect(
      fetchVerified(["http://pub.example/x"], "0".repeat(64), async () => new Response(body)),
    ).rejects.toThrow(/hash mismatch/);
  });

  test("installUrlRewrite sends every outgoing fetch (string, URL, Request) to the internal address", async () => {
    const real = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (i: RequestInfo | URL) => {
      seen.push(i instanceof Request ? i.url : String(i));
      return new Response("ok");
    }) as typeof fetch;
    try {
      process.env.URL_REWRITE = "http://localhost:3338=http://mint:3338";
      installUrlRewrite();
      await fetch("http://localhost:3338/v1/info");
      await fetch(new URL("http://localhost:3338/v1/keys"));
      await fetch(new Request("http://localhost:3338/v1/swap", { method: "POST", body: "x" }));
      await fetch("http://elsewhere/ok");
      expect(seen).toEqual([
        "http://mint:3338/v1/info",
        "http://mint:3338/v1/keys",
        "http://mint:3338/v1/swap",
        "http://elsewhere/ok",
      ]);
    } finally {
      globalThis.fetch = real;
      delete process.env.URL_REWRITE;
    }
  });
});
