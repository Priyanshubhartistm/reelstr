#!/usr/bin/env python3
"""Pay N small invoices over real Mutinynet routes and report what routing really costs.

Run on the host that runs reelstr-lnd (needs sudo docker). The coins are valueless signet coins.
  fee-test.py status                   sync, balance, channels
  fee-test.py open [local_sats]        connect to a routing node and open one channel
  fee-test.py pay [N] [amount_sats]    N payments (default 20 x 21 sats); stops at the spend cap
Invoices come from the Mutinynet faucet's node (faucet.mutinynet.com/api/bolt11, 21 sats each), so each
payment crosses at least one routing hop when our only channel goes to a different node.
"""
import json, subprocess, sys, time, urllib.request

FAUCET_NODE = "02465ed5be53d04fde66c9418ff14a5f2267723810176c9212b722e542dc1afb1b"  # issues our invoices
SPEND_CAP_SATS = 1500


def lncli(*a, check=True):
    r = subprocess.run(["sudo", "docker", "exec", "reelstr-lnd", "lncli", "--network=signet", *a],
                       capture_output=True, text=True)
    if check and r.returncode:
        sys.exit(f"lncli {' '.join(a)}: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def jl(*a):
    return json.loads(lncli(*a))


def status():
    info = jl("getinfo")
    print(f"synced_to_chain={info['synced_to_chain']} height={info['block_height']} channels={info['num_active_channels']}")
    bal = jl("walletbalance")
    print("on-chain sats:", bal["confirmed_balance"], "unconfirmed:", bal["unconfirmed_balance"])
    ch = jl("channelbalance")
    print("channel local sats:", ch["local_balance"]["sat"], "remote:", ch["remote_balance"]["sat"])
    return info, bal


def open_channel(local=50000):
    info, bal = status()
    if not info["synced_to_chain"]:
        sys.exit("not synced yet")
    if int(bal["confirmed_balance"]) < local + 2000:
        sys.exit("not enough confirmed on-chain sats yet")
    # best-connected node with a clearnet address that is not the faucet's (so payments cross a hop)
    get = lambda u: json.load(urllib.request.urlopen(u, timeout=20))
    for n in get("https://mutinynet.com/api/v1/lightning/nodes/rankings/connectivity"):
        if n["publicKey"] == FAUCET_NODE:
            continue
        node = get(f"https://mutinynet.com/api/v1/lightning/nodes/{n['publicKey']}")
        socks = [s for s in (node.get("sockets") or "").split(",") if s and ".onion" not in s]
        if not socks:
            continue
        pk = n["publicKey"]
        print("connecting to", node.get("alias"), socks[0])
        r = subprocess.run(["sudo", "docker", "exec", "reelstr-lnd", "lncli", "--network=signet", "connect",
                            f"{pk}@{socks[0]}"], capture_output=True, text=True)
        if r.returncode and "already connected" not in r.stderr:
            print("  cannot connect:", r.stderr.strip()[:100]); continue
        print(lncli("openchannel", f"--node_key={pk}", f"--local_amt={local}", "--sat_per_vbyte=2"))
        return
    sys.exit("no reachable routing node found")


def invoice(sats):
    req = urllib.request.Request("https://faucet.mutinynet.com/api/bolt11",
                                 data=json.dumps({"amount_sats": sats}).encode(),
                                 headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=20))["bolt11"]


def pay(n=20, sats=21):
    info, _ = status()
    if info["num_active_channels"] < 1:
        sys.exit("no active channel yet (run: open, then wait for confirmations)")
    rows, spent = [], 0
    for i in range(n):
        if spent + sats + 5 > SPEND_CAP_SATS:
            print("spend cap reached"); break
        try:
            bolt11 = invoice(sats)
        except Exception as e:  # the faucet rate-limits (429); back off
            print("invoice failed:", e); time.sleep(20); continue
        out = lncli("payinvoice", f"--pay_req={bolt11}", "--force", "--json", "--fee_limit=10",
                    "--timeout=40s", check=False)
        try:
            p = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        except Exception:
            p = {}
        ok = p.get("status") == "SUCCEEDED"
        fee_msat = int(p.get("fee_msat", 0)) if ok else 0
        hops = len(p["htlcs"][0]["route"]["hops"]) if ok and p.get("htlcs") else 0
        rows.append({"ok": ok, "fee_msat": fee_msat, "hops": hops, "reason": p.get("failure_reason")})
        spent += sats + fee_msat // 1000
        print(f"{i+1:>2}: {'ok ' if ok else 'FAIL'} fee {fee_msat/1000:.3f} sat, {hops} hops {p.get('failure_reason') or ''}")
        time.sleep(4)
    good = [r for r in rows if r["ok"]]
    if good:
        fees = [r["fee_msat"] / 1000 for r in good]
        print(f"\n{len(good)}/{len(rows)} succeeded. fee per {sats} sat payment: "
              f"mean {sum(fees)/len(fees):.3f} sat ({100*sum(fees)/len(fees)/sats:.1f}%), "
              f"min {min(fees):.3f}, max {max(fees):.3f}; hops {sorted({r['hops'] for r in good})}")
    json.dump(rows, open("fee-test-result.json", "w"), indent=1)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status": status()
    elif cmd == "open": open_channel(int(sys.argv[2]) if len(sys.argv) > 2 else 50000)
    elif cmd == "pay": pay(*(int(x) for x in sys.argv[2:4]))
    else: sys.exit(__doc__)
