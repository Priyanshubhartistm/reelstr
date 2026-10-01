/** What the key server and split service need from a Lightning node. */
export interface LnBackend {
  createInvoice(o: {
    sats: number;
    description: string;
  }): Promise<{ invoice: string; paymentHash: string }>;
  isPaid(paymentHash: string): Promise<boolean>;
  /** pay a BOLT11 invoice; returns the preimage */
  payInvoice(invoice: string): Promise<{ preimage: string }>;
}

/**
 * phoenixd HTTP backend (https://phoenix.acinq.co/server). Behaviour taken from phoenixd's own
 * source (src/commonMain/kotlin/fr/acinq/phoenixd/Api.kt): HTTP basic auth with the *full-access*
 * password (paying needs it), form-encoded POST bodies, `payments/incoming/{hash}` answers
 * 204 No Content for an unknown hash, and `payinvoice` answers 200 with `{reason}` and no preimage
 * when the payment fails. Tested against a mock that reproduces those behaviours, never against a
 * live node: run it on testnet before trusting it with money.
 */
export class PhoenixdBackend implements LnBackend {
  constructor(
    private readonly base: string,
    private readonly password: string,
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (i, o) =>
      fetch(i, o),
  ) {}

  private async req(
    path: string,
    form?: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    const res = await this.fetchFn(`${this.base.replace(/\/+$/, "")}${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${btoa(`:${this.password}`)}`,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
    if (res.status === 204) return { status: 204, body: null };
    const text = await res.text();
    if (!res.ok) throw new Error(`phoenixd ${path}: ${res.status} ${text}`);
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      throw new Error(`phoenixd ${path}: non-JSON answer: ${text.slice(0, 120)}`);
    }
  }

  async createInvoice(o: { sats: number; description: string }) {
    const { body } = await this.req("/createinvoice", {
      amountSat: String(o.sats),
      description: o.description,
    });
    const r = body as { serialized?: string; paymentHash?: string };
    if (!r?.serialized || !r.paymentHash)
      throw new Error("phoenixd createinvoice returned no invoice");
    return { invoice: r.serialized, paymentHash: r.paymentHash };
  }

  async isPaid(paymentHash: string) {
    const { status, body } = await this.req(`/payments/incoming/${paymentHash}`);
    if (status === 204) return false; // unknown to this node
    return (body as { isPaid?: boolean }).isPaid === true;
  }

  async payInvoice(invoice: string) {
    const { body } = await this.req("/payinvoice", { invoice });
    const r = body as { paymentPreimage?: string; reason?: string };
    if (!r.paymentPreimage)
      throw new Error(`phoenixd could not pay: ${r.reason ?? "no preimage returned"}`);
    return { preimage: r.paymentPreimage };
  }
}

/**
 * LND REST backend (https://lightning.engineering/api-docs/api/lnd/). Tested against real LND
 * 0.18 nodes on a private regtest chain (real invoices, HTLCs, preimages, routing failures), but
 * not on mainnet. Auth is the node's macaroon (hex) in `Grpc-Metadata-macaroon`; give it an
 * `invoice` + `offchain` macaroon, not admin, in production. `ca` is the node's tls.cert (PEM).
 */
export class LndBackend implements LnBackend {
  constructor(
    private readonly base: string,
    private readonly macaroonHex: string,
    private readonly ca?: string,
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (i, o) =>
      fetch(i, o),
  ) {}

  private async req(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.fetchFn(`${this.base.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Grpc-Metadata-macaroon": this.macaroonHex, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(this.ca ? ({ tls: { ca: this.ca } } as object) : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`lnd ${path}: ${res.status} ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`lnd ${path}: non-JSON answer: ${text.slice(0, 120)}`);
    }
  }

  async createInvoice(o: { sats: number; description: string }) {
    const r = await this.req("/v1/invoices", { value: String(o.sats), memo: o.description });
    if (typeof r.payment_request !== "string" || typeof r.r_hash !== "string")
      throw new Error("lnd addinvoice returned no invoice");
    return {
      invoice: r.payment_request,
      paymentHash: Buffer.from(r.r_hash, "base64").toString("hex"),
    };
  }

  async isPaid(paymentHash: string) {
    try {
      const r = await this.req(`/v1/invoice/${paymentHash}`);
      return r.state === "SETTLED";
    } catch (e) {
      if (
        /\b(404|500)\b/.test((e as Error).message) &&
        /unable to locate|not found/i.test((e as Error).message)
      )
        return false; // unknown to this node
      throw e;
    }
  }

  async payInvoice(invoice: string) {
    const r = await this.req("/v1/channels/transactions", { payment_request: invoice });
    if (typeof r.payment_error === "string" && r.payment_error)
      throw new Error(`lnd could not pay: ${r.payment_error}`);
    if (typeof r.payment_preimage !== "string" || !r.payment_preimage)
      throw new Error("lnd could not pay: no preimage returned");
    return { preimage: Buffer.from(r.payment_preimage, "base64").toString("hex") };
  }
}
