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
