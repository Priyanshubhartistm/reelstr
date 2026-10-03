#!/usr/bin/env bash
# Create the wallet of a node that is waiting for one (lncli needs a terminal, REST does not).
#   ./init-wallet.sh 8081      node A      ./init-wallet.sh 8082      node B
# The seed lands in secrets/seed-<port>.json (valueless signet coins; still keep it out of git).
set -euo pipefail
P=${1:?port}
umask 077
mkdir -p secrets
PWB=$(tr -d '\n' < secrets/pw | base64 -w0)
curl -sk "https://127.0.0.1:$P/v1/genseed" > "secrets/seed-$P.json"
python3 - "$P" "$PWB" <<'EOF2'
import json, sys
s = json.load(open(f"secrets/seed-{sys.argv[1]}.json"))
open(f"secrets/init-{sys.argv[1]}.req", "w").write(json.dumps({"wallet_password": sys.argv[2], "cipher_seed_mnemonic": s["cipher_seed_mnemonic"]}))
EOF2
curl -sk -X POST "https://127.0.0.1:$P/v1/initwallet" -d "@secrets/init-$P.req" > "secrets/init-$P.out"
python3 -c "import json,sys; d=json.load(open('secrets/init-$P.out')); print('wallet created' if 'admin_macaroon' in d else d)"
