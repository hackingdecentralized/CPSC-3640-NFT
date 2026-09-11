#!/usr/bin/env bash
#
# Verify an already-deployed contract on the explorer.
#
# Only needed when `scripts/deploy.sh` deployed successfully but the explorer
# submission failed, which happens on rate limits or if the explorer had not yet
# indexed the creation transaction.
#
#   scripts/verify.sh sepolia
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

NETWORK="${1:-sepolia}"
RECORD="deployments/$NETWORK.json"
[ -f "$RECORD" ] || die "no $RECORD"

[ -f .env ] && { set -a; . ./.env; set +a; }
[ -n "${ETHERSCAN_API_KEY:-}" ] || die "ETHERSCAN_API_KEY is not set in .env"

read -r ADDRESS CHAIN_ID OWNER ROOT OPEN <<<"$(python3 -c "
import json
d = json.load(open('$RECORD'))
if not d.get('contractAddress'):
    raise SystemExit('$RECORD has no contractAddress - deploy first')
args = d.get('constructorArgs')
if not args:
    raise SystemExit('$RECORD has no constructorArgs - redeploy, or verify by hand')
print(d['contractAddress'], d['chainId'], *args)
")"

# Taken from the deployment record, not guessed: the encoded arguments have to
# match the creation transaction exactly or the bytecode will not line up.
ARGS="$(cast abi-encode 'constructor(address,bytes32,bool)' "$OWNER" "$ROOT" "$OPEN")"

echo "Verifying $ADDRESS on chain $CHAIN_ID"
echo "  owner      $OWNER"
echo "  merkleRoot $ROOT"
echo "  claimOpen  $OPEN"

forge verify-contract "$ADDRESS" contracts/CPSC3640NFT.sol:CPSC3640NFT \
  --chain "$CHAIN_ID" \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args "$ARGS" \
  --watch
