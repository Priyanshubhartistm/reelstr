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
 * phoenixd HTTP backend (https://phoenix.acinq.co/server). NOT exercised by the test suite:
 * tests use FakeLightning, so run it against testnet before trusting it with money.
 */
export class PhoenixdBackend implements LnBackend {
  constructor(
    private readonly base: string,
    private readonly password: string,
  ) {}
  private async req<T>(path: string, form?: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${btoa(`:${this.password}`)}`,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
    if (!res.ok) throw new Error(`phoenixd ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
  async createInvoice(o: { sats: number; description: string }) {
    const r = await this.req<{ serialized: string; paymentHash: string }>("/createinvoice", {
      amountSat: String(o.sats),
      description: o.description,
    });
    return { invoice: r.serialized, paymentHash: r.paymentHash };
  }
  async isPaid(paymentHash: string) {
    const r = await this.req<{ isPaid: boolean }>(`/payments/incoming/${paymentHash}`);
    return r.isPaid;
  }
  async payInvoice(invoice: string) {
    const r = await this.req<{ paymentPreimage: string }>("/payinvoice", { invoice });
    return { preimage: r.paymentPreimage };
  }
}
