import type { Config } from "@reelstr/app-core";

export type Endpoints = Omit<Config, "signer">;

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const KEY = "reelstr.endpoints";

export const defaultEndpoints = (): Endpoints => ({
  relays: (env.VITE_RELAYS ?? "ws://127.0.0.1:3334").split(","),
  blossom: env.VITE_BLOSSOM ?? "http://127.0.0.1:3100",
  mirrors: (env.VITE_MIRRORS ?? "").split(",").filter(Boolean),
  mediaUrl: env.VITE_MEDIA_URL ?? "http://127.0.0.1:3200",
  indexerUrl: env.VITE_INDEXER_URL ?? "http://127.0.0.1:3300",
  keysUrl: env.VITE_KEYS_URL ?? "http://127.0.0.1:3400",
  powBits: Number(env.VITE_POW_BITS ?? 0),
});

export function loadEndpoints(): Endpoints {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultEndpoints(), ...JSON.parse(raw) };
  } catch {}
  return defaultEndpoints();
}

export function saveEndpoints(e: Endpoints) {
  try {
    localStorage.setItem(KEY, JSON.stringify(e));
  } catch {}
}
