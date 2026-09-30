#!/usr/bin/env python3
"""Independent Reelstr reader (NP-7). Uses only the Python standard library and implements the NIP
draft from docs/nip/reelstr.md without sharing any code with @reelstr/protocol.

    python3 reader.py events.json      # a JSON array of raw Nostr events (or {"event": {...}} objects)

For every Cut it: verifies the event id and BIP340 signature, checks the scene pins, recomputes the
payment split from trimmed milliseconds and compares it with the declared zap weights, and prints
a one-line credit summary. Exit code 1 if any Cut fails.
"""
import hashlib
import json
import sys

# ---- secp256k1 / BIP340 (verification only) ----
P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def add(a, b):
    if a is None: return b
    if b is None: return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0: return None
    if a == b: m = 3 * a[0] * a[0] * pow(2 * a[1], -1, P) % P
    else: m = (b[1] - a[1]) * pow(b[0] - a[0], -1, P) % P
    x = (m * m - a[0] - b[0]) % P
    return (x, (m * (a[0] - x) - a[1]) % P)


def mul(pt, k):
    r = None
    while k:
        if k & 1: r = add(r, pt)
        pt = add(pt, pt)
        k >>= 1
    return r


def tagged(tag, *parts):
    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + b"".join(parts)).digest()


def lift_x(x):
    if x >= P: return None
    y2 = (pow(x, 3, P) + 7) % P
    y = pow(y2, (P + 1) // 4, P)
    if y * y % P != y2: return None
    return (x, y if y % 2 == 0 else P - y)


def schnorr_verify(msg, pub, sig):
    if len(pub) != 32 or len(sig) != 64: return False
    pt = lift_x(int.from_bytes(pub, "big"))
    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:], "big")
    if pt is None or r >= P or s >= N: return False
    e = int.from_bytes(tagged("BIP0340/challenge", sig[:32], pub, msg), "big") % N
    R = add(mul(G, s), mul(pt, N - e))
    return R is not None and R[1] % 2 == 0 and R[0] == r


def event_id(e):
    ser = json.dumps([0, e["pubkey"], e["created_at"], e["kind"], e["tags"], e["content"]], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(ser.encode()).hexdigest()


def sig_ok(e):
    try:
        return event_id(e) == e["id"] and schnorr_verify(bytes.fromhex(e["id"]), bytes.fromhex(e["pubkey"]), bytes.fromhex(e["sig"]))
    except Exception:
        return False


# ---- the draft: Cut (kind 31811) ----
CUT = 31811


def tags(e, name):
    return [t for t in e["tags"] if t and t[0] == name]


def ms(s):
    whole, _, frac = s.partition(".")
    return int(whole) * 1000 + int((frac + "000")[:3])


def apportion(quotas, total):
    """Largest remainder; ties go to the earlier entry."""
    s = sum(quotas)
    base = [q * total // s for q in quotas]
    rem = sorted(range(len(quotas)), key=lambda i: (-(quotas[i] * total % s), i))
    for i in rem[: total - sum(base)]:
        base[i] += 1
    return base


def expected_weights(cut):
    zaps = tags(cut, "zap")
    by_role = {}
    for z in zaps:
        by_role.setdefault(z[4], []).append(z)
    curator = sum(int(z[3]) for z in by_role.get("curator", []))
    host = sum(int(z[3]) for z in by_role.get("host", []))
    pool = 10000 - curator - host
    bed = tags(cut, "audio-bed")
    bed_bps = int(bed[0][3]) if bed and len(bed[0]) > 3 else 1000
    bed_w = pool * bed_bps // 10000 if bed else 0
    order, dur = [], {}
    for t in tags(cut, "scene"):
        payee = t[5]
        if payee not in dur: order.append(payee)
        dur[payee] = dur.get(payee, 0) + ms(t[4]) - ms(t[3])
    shares = apportion([dur[p] for p in order], pool - bed_w) if pool - bed_w > 0 else [0] * len(order)
    out = [("creator", p, w) for p, w in zip(order, shares)]
    if bed and bed_w: out.append(("audio", bed[0][2], bed_w))
    out.append(("curator", by_role["curator"][0][1] if "curator" in by_role else cut["pubkey"], curator))
    out.append(("host", by_role["host"][0][1] if "host" in by_role else cut["pubkey"], host))
    return sorted((r, p, w) for r, p, w in out if w > 0)


def check_cut(cut):
    errs = []
    if not sig_ok(cut): errs.append("bad id or signature")
    scenes = tags(cut, "scene")
    if not scenes: errs.append("no scenes")
    for i, t in enumerate(scenes):
        if len(t) < 6 or len(t[1]) != 64 or len(t[2]) != 64: errs.append(f"scene[{i}] not pinned by id and sha256")
        elif ms(t[4]) <= ms(t[3]): errs.append(f"scene[{i}] trim out <= in")
    zaps = tags(cut, "zap")
    if sum(int(z[3]) for z in zaps) != 10000: errs.append("zap weights do not sum to 10000")
    declared = sorted((z[4], z[1], int(z[3])) for z in zaps if int(z[3]) > 0)
    if not errs and declared != expected_weights(cut): errs.append("declared split differs from recomputed split")
    return errs


def main(path):
    raw = json.load(open(path))
    events = [x["event"] if "event" in x else x for x in raw]
    bad = 0
    for e in events:
        if e["kind"] != CUT: continue
        errs = check_cut(e)
        d = next((t[1] for t in tags(e, "d")), "?")
        secs = sum(ms(t[4]) - ms(t[3]) for t in tags(e, "scene")) / 1000
        if errs:
            bad += 1
            print(f"FAIL {d}: {'; '.join(errs)}")
        else:
            w = ", ".join(f"{r} {p[:6]} {x/100:.2f}%" for r, p, x in expected_weights(e))
            print(f"OK   {d}: {secs:.1f}s, {len(tags(e, 'scene'))} scenes, sig ok, split ok [{w}]")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main(sys.argv[1])
