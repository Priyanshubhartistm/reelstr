import { afterAll, describe, expect, test } from "bun:test";
import { paymentHashOf } from "@reelstr/bolt11";
import { FakeLightning } from "@reelstr/testkit";
import { PhoenixdBackend } from "../src";

// A mock that behaves like phoenixd's Api.kt: basic auth, form bodies, 204 for unknown hashes, 200 + reason on failure.
const ln = new FakeLightning();
const PASSWORD = "full-access-pw";
const seen: { path: string; ct: string | null; form?: Record<string, string> }[] = [];
const srv: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  async fetch(req): Promise<Response> {
    const u = new URL(req.url);
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Basic ${btoa(`:${PASSWORD}`)}`)
      return new Response(
        "Invalid authentication (use basic auth with the http password set in phoenix.conf)",
        { status: 401 },
      );
    const form =
      req.method === "POST" ? Object.fromEntries(new URLSearchParams(await req.text())) : undefined;
    seen.push({ path: u.pathname, ct: req.headers.get("content-type"), form });
    if (req.method === "POST" && u.pathname === "/createinvoice") {
      if (!form?.description)
        return new Response("Missing description or descriptionHash", { status: 400 });
      const inv = ln.createInvoice({ sats: Number(form.amountSat), description: form.description });
      return Response.json({
        amountSat: Number(form.amountSat),
        paymentHash: inv.paymentHash,
        serialized: inv.invoice,
      });
    }
    if (req.method === "GET" && u.pathname.startsWith("/payments/incoming/")) {
      const hash = u.pathname.split("/").pop() as string;
      return hash in known
        ? Response.json({ paymentHash: hash, isPaid: ln.isPaid(hash), receivedSat: 0 })
        : new Response(null, { status: 204 });
    }
    if (req.method === "POST" && u.pathname === "/payinvoice") {
      try {
        const r = ln.pay(form?.invoice ?? "");
        return Response.json({
          recipientAmountSat: r.sats,
          routingFeeSat: 0,
          paymentId: "x",
          paymentHash: "x",
          paymentPreimage: r.preimage,
        });
      } catch (e) {
        return Response.json({ reason: (e as Error).message }); // 200, no preimage: how phoenixd reports PaymentFailed
      }
    }
    return new Response("Unknown endpoint (check api doc)", { status: 404 });
  },
});
const known: Record<string, true> = {};
afterAll(() => srv.stop(true));
const be = new PhoenixdBackend(`http://127.0.0.1:${srv.port}`, PASSWORD);

describe("PhoenixdBackend against a mock of phoenixd's real API behaviour", () => {
  test("createInvoice sends a form-encoded body with amountSat and description, and reads `serialized`", async () => {
    const inv = await be.createInvoice({ sats: 42, description: "unlock ep 1" });
    known[inv.paymentHash] = true;
    expect(inv.invoice.startsWith("lnbc")).toBe(true);
    const call = seen.find((s) => s.path === "/createinvoice");
    expect(call?.ct).toContain("application/x-www-form-urlencoded");
    expect(call?.form).toEqual({ amountSat: "42", description: "unlock ep 1" });
  });

  test("isPaid: unknown hash (204) is false, issued-but-unpaid is false, paid is true", async () => {
    expect(await be.isPaid("0".repeat(64))).toBe(false);
    const inv = await be.createInvoice({ sats: 5, description: "x" });
    known[inv.paymentHash] = true;
    expect(await be.isPaid(inv.paymentHash)).toBe(false);
    ln.pay(inv.invoice);
    expect(await be.isPaid(inv.paymentHash)).toBe(true);
  });

  test("payInvoice returns the preimage; a failed payment (200 + reason) throws instead of faking success", async () => {
    const inv = ln.createInvoice({ sats: 7 });
    const r = await be.payInvoice(inv.invoice);
    expect(paymentHashOf(r.preimage)).toBe(inv.paymentHash);
    await expect(be.payInvoice(inv.invoice)).rejects.toThrow(/could not pay: invoice already paid/);
    await expect(be.payInvoice("lnbc1unknown")).rejects.toThrow(/could not pay/);
  });

  test("a wrong password and an unreachable node are errors, not silent failures", async () => {
    await expect(
      new PhoenixdBackend(`http://127.0.0.1:${srv.port}`, "nope").createInvoice({
        sats: 1,
        description: "x",
      }),
    ).rejects.toThrow(/401/);
    await expect(
      new PhoenixdBackend("http://127.0.0.1:1", PASSWORD).isPaid("a".repeat(64)),
    ).rejects.toThrow();
  });
});
