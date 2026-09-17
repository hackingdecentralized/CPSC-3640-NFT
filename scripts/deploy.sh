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
. scripts/lib.sh

NETWORK="${1:-}"
[ -n "$NETWORK" ] || die "usage: scripts/deploy.sh <sepolia|anvil> [--no-verify]"
VERIFY=1
[ "${2:-}" = "--no-verify" ] && VERIFY=0

use_network "$NETWORK"
[ "$CHAIN_ID" = 31337 ] && VERIFY=0

# 1. Secrets ------------------------------------------------------------------
load_env "$NETWORK" 1

if [ "$VERIFY" -eq 1 ] && [ -z "${ETHERSCAN_API_KEY:-}" ]; then
  warn "ETHERSCAN_API_KEY is not set, so the source will not be verified."
  warn "Add it to .env and re-run scripts/verify.sh $NETWORK afterwards."
  VERIFY=0
fi

# 2. Refuse to ship code that does not pass its tests -------------------------
# Deploy.s.sol prints the deployer and refuses an unfunded one before anything is
# sent. Working the address out here would put the key on a command line.
say "Running contract tests"
forge test >/dev/null || die "tests failed - not deploying"

# 3. Allowlist ----------------------------------------------------------------
# Open by default: anyone may claim one token, and there is no roster to build.
# Set REQUIRE_ALLOWLIST=true to restrict claiming to allowlist/addresses.json.
REQUIRE_ALLOWLIST="${REQUIRE_ALLOWLIST:-false}"
export REQUIRE_ALLOWLIST

if [ "$REQUIRE_ALLOWLIST" = "false" ]; then
  say "Allowlist: OFF (the default)"
  echo "    Any address may claim one token. One per wallet still holds, but one"
  echo "    person can use several wallets, so this is open to whoever finds the page."
  echo "    Restrict it with: REQUIRE_ALLOWLIST=true scripts/deploy.sh $NETWORK"
else
  [ -f allowlist/generated/root.json ] || die "no Merkle root. Run: npm run merkle"
  MERKLE_ROOT="$(python3 -c 'import json;print(json.load(open("allowlist/generated/root.json"))["merkleRoot"])')"
  COUNT="$(python3 -c 'import json;print(json.load(open("allowlist/generated/root.json"))["addressCount"])')"
  SOURCE="$(python3 -c 'import json;print(json.load(open("allowlist/generated/root.json"))["source"])')"
  say "Allowlist: $COUNT addresses from $SOURCE"
  echo "    root: $MERKLE_ROOT"

  # The generator falls back to the Anvil example roster when addresses.json is
  # absent. Deploying that would allow five test accounts and no real student.
  if [ "$NETWORK" = "sepolia" ] && [ "$SOURCE" = "allowlist/addresses.example.json" ]; then
    warn "This root is the Anvil example roster, not a real one."
    warn "Five test accounts could claim, and nobody else."
    echo "    You probably want one of:"
    echo "      REQUIRE_ALLOWLIST=false scripts/deploy.sh sepolia   # let anyone claim"
    echo "      put real addresses in allowlist/addresses.json, then: npm run merkle"
    printf '    Continue with the example roster anyway? [y/N] '
    read -r reply
    [ "$reply" = "y" ] || die "aborted"
  fi
fi

# 4. Deploy, verifying as part of the same run --------------------------------
say "Deploying to $NETWORK"
set -- forge script script/Deploy.s.sol --rpc-url "$FORGE_RPC" --broadcast
if [ "$VERIFY" -eq 1 ]; then
  # --verify submits the source once the creation transaction is mined, so a
  # successful run leaves a verified contract with no second step. forge reads
  # ETHERSCAN_API_KEY from the environment.
  set -- "$@" --verify --chain "$CHAIN_ID"
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
if [ "$VERIFY" -eq 1 ]; then
  echo "Source verification was submitted as part of the deploy."
fi
