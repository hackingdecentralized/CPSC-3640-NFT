#!/usr/bin/env bash
#
# Deploy the course NFT and verify its source on the explorer, in one command.
#
#   scripts/deploy.sh sepolia
#   scripts/deploy.sh anvil          # local, no verification
#   scripts/deploy.sh sepolia --no-verify
#
# Reads secrets from .env, which is git-ignored and never reaches the browser.
# Refuses to deploy if the tests do not pass or the allowlist is missing.
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

NETWORK="${1:-}"
[ -n "$NETWORK" ] || die "usage: scripts/deploy.sh <sepolia|anvil> [--no-verify]"
VERIFY=1
[ "${2:-}" = "--no-verify" ] && VERIFY=0

case "$NETWORK" in
  sepolia) CHAIN_ID=11155111 ;;
  anvil|localhost) CHAIN_ID=31337; VERIFY=0 ;;
  *) die "unknown network '$NETWORK'. Expected sepolia or anvil." ;;
esac

# 1. Secrets ------------------------------------------------------------------
# .env fills in what the environment has not already provided, so an explicit
# `DEPLOYER_PRIVATE_KEY=... scripts/deploy.sh anvil` is not silently overridden
# by the Sepolia credentials sitting in the file.
_preset_key="${DEPLOYER_PRIVATE_KEY:-}"
_preset_rpc="${SEPOLIA_RPC_URL:-}"
_preset_scan="${ETHERSCAN_API_KEY:-}"

if [ -f .env ]; then
  set -a; . ./.env; set +a
elif [ "$NETWORK" != "anvil" ]; then
  die "no .env file. Copy .env.example to .env and fill it in."
fi

[ -n "$_preset_key" ] && DEPLOYER_PRIVATE_KEY="$_preset_key"
[ -n "$_preset_rpc" ] && SEPOLIA_RPC_URL="$_preset_rpc"
[ -n "$_preset_scan" ] && ETHERSCAN_API_KEY="$_preset_scan"

if [ "$NETWORK" = "sepolia" ]; then
  [ -n "${SEPOLIA_RPC_URL:-}" ] || die "SEPOLIA_RPC_URL is not set in .env"
  [ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "DEPLOYER_PRIVATE_KEY is not set in .env"
  RPC_URL="$SEPOLIA_RPC_URL"
else
  RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
  : "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY to an Anvil key for local deploys}"
fi

# Foundry insists on the 0x prefix and its error message for a bare key is cryptic.
# Accept both spellings and fail here, clearly, on anything that is not a 32-byte key.
case "$DEPLOYER_PRIVATE_KEY" in
  0x*) ;;
  *) DEPLOYER_PRIVATE_KEY="0x$DEPLOYER_PRIVATE_KEY" ;;
esac
if ! printf '%s' "$DEPLOYER_PRIVATE_KEY" | grep -qE '^0x[0-9a-fA-F]{64}$'; then
  die "DEPLOYER_PRIVATE_KEY is not a 32-byte hex key (expected 0x + 64 hex characters)"
fi
export DEPLOYER_PRIVATE_KEY

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"

if [ "$VERIFY" -eq 1 ] && [ -z "${ETHERSCAN_API_KEY:-}" ]; then
  warn "ETHERSCAN_API_KEY is not set, so the source will not be verified."
  warn "Add it to .env and re-run scripts/verify.sh $NETWORK afterwards."
  VERIFY=0
fi

# 2. Refuse to ship code that does not pass its tests -------------------------
say "Deployer $DEPLOYER_ADDRESS"
BALANCE="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo 0)"
echo "    balance: $(cast from-wei "$BALANCE") ETH"
if [ "$BALANCE" = "0" ]; then
  die "deployer has no ETH on $NETWORK. Fund it from a Sepolia faucet first."
fi

say "Running contract tests"
forge test >/dev/null || die "tests failed - not deploying"

# 3. Allowlist ----------------------------------------------------------------
[ -f allowlist/generated/root.json ] || die "no Merkle root. Run: npm run merkle"
MERKLE_ROOT="$(python3 -c 'import json;print(json.load(open("allowlist/generated/root.json"))["merkleRoot"])')"
COUNT="$(python3 -c 'import json;print(json.load(open("allowlist/generated/root.json"))["addressCount"])')"
SOURCE="$(python3 -c 'import json;print(json.load(open("allowlist/generated/root.json"))["source"])')"
say "Allowlist: $COUNT addresses from $SOURCE"
echo "    root: $MERKLE_ROOT"

if [ "$NETWORK" = "sepolia" ] && [ "$SOURCE" = "allowlist/addresses.example.json" ]; then
  warn "This root is the Anvil example roster, not a real one."
  printf '    Continue anyway? [y/N] '
  read -r reply
  [ "$reply" = "y" ] || die "aborted"
fi

# 4. Deploy, verifying as part of the same run --------------------------------
say "Deploying to $NETWORK"
set -- forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast
if [ "$VERIFY" -eq 1 ]; then
  # --verify submits the source once the creation transaction is mined, so a
  # successful run leaves a verified contract with no second step.
  set -- "$@" --verify --chain "$CHAIN_ID" --etherscan-api-key "$ETHERSCAN_API_KEY"
fi

if "$@"; then
  DEPLOY_OK=1
else
  DEPLOY_OK=0
fi

# 5. Record it, whether or not verification succeeded -------------------------
# The contract may well be live even if the explorer submission failed, so the
# deployment record is written either way and verification can be retried.
say "Recording deployment"
node scripts/save-deployment.mjs "$NETWORK" "$CHAIN_ID"

if [ "$DEPLOY_OK" -eq 0 ]; then
  warn "The forge run reported a failure."
  warn "If the contract deployed but verification failed, retry with:"
  warn "  scripts/verify.sh $NETWORK"
  exit 1
fi

ADDRESS="$(python3 -c "import json;print(json.load(open('deployments/$NETWORK.json'))['contractAddress'])")"
cat <<DONE

Deployed to $NETWORK: $ADDRESS
Recorded in deployments/$NETWORK.json

Next:
  git add deployments/$NETWORK.json && git commit -m "Record $NETWORK deployment"
  scripts/publish-pages.sh
DONE
[ "$VERIFY" -eq 1 ] && echo "Source verification was submitted as part of the deploy."
