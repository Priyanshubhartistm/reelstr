import { afterEach, describe, expect, test } from "bun:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { httpAuthHeader, httpAuthTemplate, verifyHttpAuth } from "../src";

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const signed = (url: string, method = "POST", body?: string) =>
  httpAuthHeader(finalizeEvent(httpAuthTemplate({ url, method, body }), sk) as never);
const req = (url: string, auth: string, body?: string) =>
  new Request(url, { method: "POST", headers: { authorization: auth }, body });
afterEach(() => {
  delete process.env.PUBLIC_PATH_PREFIX;
});

describe("NIP-98 behind a reverse proxy that strips a path prefix", () => {
  test("without a prefix the signed path must equal the received path (unchanged behaviour)", () => {
    const body = '{"a":1}';
    expect(
      verifyHttpAuth(
        req("http://svc/ingest", signed("https://svc/ingest", "POST", body), body),
        body,
      ),
    ).toBe(pk);
    expect(
      verifyHttpAuth(
        req("http://svc/ingest", signed("https://pub/reelstr/media/ingest", "POST", body), body),
        body,
      ),
    ).toBeNull();
  });

  test("with PUBLIC_PATH_PREFIX the client signs the public path and the service sees the stripped one", () => {
    process.env.PUBLIC_PATH_PREFIX = "/reelstr/media/";
    const body = '{"a":1}';
    const ok = signed("https://pub/reelstr/media/ingest", "POST", body);
    expect(verifyHttpAuth(req("http://127.0.0.1:3200/ingest", ok, body), body)).toBe(pk);
    // strict: a signature for the unprefixed path no longer verifies, nor one for a different endpoint
    expect(
      verifyHttpAuth(
        req(
          "http://127.0.0.1:3200/ingest",
          signed("http://127.0.0.1:3200/ingest", "POST", body),
          body,
        ),
        body,
      ),
    ).toBeNull();
    expect(verifyHttpAuth(req("http://127.0.0.1:3200/render", ok, body), body)).toBeNull();
    // a signature made for another service's prefix does not work here
    expect(
      verifyHttpAuth(
        req(
          "http://127.0.0.1:3200/ingest",
          signed("https://pub/reelstr/keys/ingest", "POST", body),
          body,
        ),
        body,
      ),
    ).toBeNull();
  });

  test("the prefix can also be passed explicitly", () => {
    const body = "x";
    const h = signed("https://pub/p/keys/episodes", "POST", body);
    expect(verifyHttpAuth(req("http://k/episodes", h, body), body, "/p/keys")).toBe(pk);
  });
});
