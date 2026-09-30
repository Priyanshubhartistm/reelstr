import { payoutSats, type Weight } from "@reelstr/protocol";

const short = (pk: string) => `${pk.slice(0, 8)}…${pk.slice(-4)}`;

/** FE-6 / FE-10: who gets what share; sats for a sample price. */
export function SplitTable({
  weights,
  priceSats,
  names,
}: {
  weights: Weight[];
  priceSats: number;
  names?: Record<string, string>;
}) {
  const sats = priceSats > 0 ? payoutSats(weights, priceSats) : weights.map(() => 0);
  return (
    <table className="split">
      <thead>
        <tr>
          <th>Recipient</th>
          <th>Role</th>
          <th>Weight</th>
          <th>Share</th>
          <th>{priceSats} sats</th>
        </tr>
      </thead>
      <tbody>
        {weights.map((w, i) => (
          <tr key={`${w.role}${w.pubkey}`}>
            <td title={w.pubkey}>{names?.[w.pubkey] ?? short(w.pubkey)}</td>
            <td>{w.role}</td>
            <td>{w.weight}</td>
            <td>{(w.weight / 100).toFixed(2)}%</td>
            <td>{sats[i]}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total</td>
          <td>{weights.reduce((a, w) => a + w.weight, 0)}</td>
          <td>100%</td>
          <td>{sats.reduce((a, b) => a + b, 0)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
