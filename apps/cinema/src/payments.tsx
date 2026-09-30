import { useSession } from "@reelstr/ui";
import { CashuWallet, MemoryStore, Nip60Store, NwcWallet, SpendGuard } from "@reelstr/wallet";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

interface Payments {
  mintUrl: string;
  setMintUrl: (u: string) => void;
  nwcUri: string;
  setNwcUri: (u: string) => void;
  nwc: NwcWallet | null;
  wallet: CashuWallet | null;
  balance: number;
  /** set while a top-up invoice is waiting to be paid */
  invoice: string | null;
  error: string;
  guard: SpendGuard;
  capSats: number;
  setCapSats: (n: number) => void;
  topUp: (sats: number) => Promise<void>;
  history: { direction: string; sats: number; note: string; at: number }[];
  record: (direction: "in" | "out", sats: number, note: string) => Promise<void>;
  refresh: () => Promise<void>;
  persistedOnRelays: boolean;
}
const Ctx = createContext<Payments | null>(null);
export const usePayments = () => {
  const p = useContext(Ctx);
  if (!p) throw new Error("usePayments outside PaymentsProvider");
  return p;
};

/** FE-9: a built-in NIP-60 Cashu wallet, or an NWC wallet; balance and history live on relays. */
export function PaymentsProvider({ children }: { children: ReactNode }) {
  const { client } = useSession();
  const [mintUrl, setMint] = useState(get("reelstr.mint") ?? env.VITE_MINT ?? "");
  const [nwcUri, setNwc] = useState(get("reelstr.nwc") ?? "");
  const [capSats, setCap] = useState(Number(get("reelstr.cap") ?? 500));
  const [wallet, setWallet] = useState<CashuWallet | null>(null);
  const [balance, setBalance] = useState(0);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Payments["history"]>([]);
  const [persisted, setPersisted] = useState(false);
  const store = useRef<Nip60Store | null>(null);

  const nwc = useMemo(() => {
    try {
      return nwcUri ? NwcWallet.fromUri(nwcUri) : null;
    } catch {
      return null;
    }
  }, [nwcUri]);
  const guard = useMemo(() => new SpendGuard({ get, set }, capSats), [capSats]);

  const refresh = useCallback(async () => {
    if (!client || !mintUrl) return setWallet(null);
    setError("");
    try {
      let proofStore: Nip60Store | MemoryStore;
      try {
        proofStore = new Nip60Store(client.pool, client.cfg.relays, client.cfg.signer, mintUrl);
        store.current = proofStore;
        setPersisted(true);
        await proofStore.load();
      } catch {
        // signer without NIP-44 (some extensions): keep the wallet in memory and say so
        proofStore = new MemoryStore();
        store.current = null;
        setPersisted(false);
      }
      const w = await CashuWallet.open(mintUrl, proofStore);
      await w.prune().catch(() => 0);
      setWallet(w);
      setBalance(w.balance());
      if (store.current) setHistory(await store.current.history().catch(() => []));
    } catch (e) {
      setError((e as Error).message);
      setWallet(null);
    }
  }, [client, mintUrl]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the account or mint changes
  useEffect(() => {
    void refresh();
  }, [client, mintUrl]);

  const record = useCallback(async (direction: "in" | "out", sats: number, note: string) => {
    await store.current?.record(direction, sats, note).catch(() => {});
    if (store.current) setHistory(await store.current.history().catch(() => []));
  }, []);

  const value: Payments = {
    mintUrl,
    nwcUri,
    nwc,
    wallet,
    balance,
    invoice,
    error,
    guard,
    capSats,
    history,
    persistedOnRelays: persisted,
    refresh,
    record,
    setMintUrl: (u) => {
      set("reelstr.mint", u);
      setMint(u);
    },
    setNwcUri: (u) => {
      set("reelstr.nwc", u);
      setNwc(u);
    },
    setCapSats: (n) => {
      set("reelstr.cap", String(n));
      setCap(n);
    },
    async topUp(sats) {
      if (!wallet) throw new Error("connect a mint first");
      setError("");
      try {
        // the mint's invoice is shown for an external wallet, or paid straight away through NWC
        await wallet.topUp(sats, async (inv) => {
          setInvoice(inv);
          if (nwc) await nwc.payInvoice(inv, sats);
        });
        setBalance(wallet.balance());
        await record("in", sats, "top up");
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setInvoice(null);
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
