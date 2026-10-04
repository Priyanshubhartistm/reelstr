import type { Weight } from "@reelstr/protocol";
import { go, SplitTable, useAsync, useSession } from "@reelstr/ui";

/** FE-10: every recipient, seconds used and share. Totals equal 100% of the Cut's weights. */
export function Credits({ cutId, priceSats }: { cutId: string; priceSats: number }) {
  const { client } = useSession();
  const c = useAsync(
    () =>
      (client as NonNullable<typeof client>).api<
        { pubkey: string; role: string; weight: number; seconds: number }[]
      >(`/cuts/${cutId}/credits`),
    [cutId],
  );
  if (!c.data?.length) return null;
  const weights: Weight[] = c.data.map((x) => ({
    pubkey: x.pubkey,
    role: x.role as Weight["role"],
    weight: x.weight,
  }));
  return (
    <>
      <h2>Credits and split</h2>
      <p className="muted">Declared in the curator's signed episode event. Anyone can check it.</p>
      <div className="card">
        <div className="scroll">
          <SplitTable weights={weights} priceSats={priceSats} />
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Seconds used:{" "}
          {c.data
            .filter((x) => x.role === "creator")
            .map((x) => `${x.pubkey.slice(0, 6)}… ${x.seconds.toFixed(1)}s`)
            .join(" · ")}
        </p>
      </div>
    </>
  );
}
export { go };
