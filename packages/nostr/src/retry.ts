/**
 * Run `fn` until it succeeds, for service start-up when a dependency (database, mint) may still be
 * coming up. Throws the last error after `tries` attempts.
 */
export async function retry<T>(
  label: string,
  fn: () => Promise<T>,
  o: { tries?: number; delayMs?: number; log?: (s: string) => void } = {},
): Promise<T> {
  const tries = o.tries ?? 30;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      (o.log ?? console.log)(
        `${label} not ready (${(e as Error).message.split("\n")[0]}), retry ${i}/${tries}`,
      );
      await new Promise((r) => setTimeout(r, o.delayMs ?? 2000));
    }
  }
}
