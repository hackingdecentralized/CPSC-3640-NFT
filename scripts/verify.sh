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
. scripts/lib.sh

NETWORK="${1:-sepolia}"
RECORD="deployments/$NETWORK.json"
[ -f "$RECORD" ] || die "no $RECORD"

_preset_scan="${ETHERSCAN_API_KEY:-}"
[ -f .env ] && { set -a; . ./.env; set +a; }
[ -n "$_preset_scan" ] && ETHERSCAN_API_KEY="$_preset_scan"
[ -n "${ETHERSCAN_API_KEY:-}" ] || die "ETHERSCAN_API_KEY is not set in .env"

read -r ADDRESS CHAIN_ID OWNER ROOT OPEN ALLOWLIST <<<"$(python3 -c "
import json
d = json.load(open('$RECORD'))
if not d.get('contractAddress'):
    raise SystemExit('$RECORD has no contractAddress - deploy first')
args = d.get('constructorArgs')
if not args or len(args) != 4:
    raise SystemExit('$RECORD does not record the four constructor arguments - redeploy, or verify by hand')
print(d['contractAddress'], d['chainId'], *args)
")"
[ -n "${ALLOWLIST:-}" ] || exit 1

# Taken from the deployment record, not guessed: the encoded arguments have to
# match the creation transaction exactly or the bytecode will not line up.
ARGS="$(cast abi-encode 'constructor(address,bytes32,bool,bool)' "$OWNER" "$ROOT" "$OPEN" "$ALLOWLIST")"

echo "Verifying $ADDRESS on chain $CHAIN_ID"
echo "  owner      $OWNER"
echo "  merkleRoot $ROOT"
echo "  claimOpen  $OPEN"
echo "  allowlist  $ALLOWLIST"

forge verify-contract "$ADDRESS" contracts/CPSC3640NFT.sol:CPSC3640NFT \
  --chain "$CHAIN_ID" \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args "$ARGS" \
  --watch
