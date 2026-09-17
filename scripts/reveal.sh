#!/usr/bin/env bash
#
# Owner actions for revealing the generated collection.
#
#   scripts/reveal.sh sepolia status
#   scripts/reveal.sh sepolia publish <METADATA_CID>   # or an https:// base URL
#   scripts/reveal.sh sepolia close                    # stop new claims
#   scripts/reveal.sh sepolia open                     # allow claims again
#   scripts/reveal.sh sepolia freeze                   # make the reveal permanent
#
# The whole sequence (README, "Revealing the cards"):
#   cd generator && npm run collection -- --network sepolia
#   upload images/, npm run set-image-cid, upload metadata/
#   scripts/reveal.sh sepolia publish <METADATA_CID>
#
# `publish` and `freeze` first run the generator's check-reveal, which compares every
# token with the chain and every uploaded file with the generated one. They stop on
# any mismatch or missing file.
#
#   IPFS_GATEWAY=https://...   where uploads are read back from (default ipfs.io)
#   REVEAL_QUICK=1             only confirm images exist, except the first and last
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
. scripts/lib.sh

NETWORK="${1:-}"
ACTION="${2:-}"
[ -n "$NETWORK" ] && [ -n "$ACTION" ] || die "usage: scripts/reveal.sh <sepolia|anvil> <status|publish|close|open|freeze>"
use_network "$NETWORK"

ADDRESS="$(record_field "$NETWORK" contractAddress)"
[ -n "$ADDRESS" ] || die "deployments/$NETWORK.json has no contract address. Deploy first: scripts/deploy.sh $NETWORK"

case "$ACTION" in
  status) load_env "$NETWORK" 0 ;;
  publish|close|open|freeze) load_env "$NETWORK" 1 ;;
  *) die "unknown action '$ACTION'. Expected status, publish, close, open or freeze." ;;
esac

MANIFEST="generator/output/collection/$NETWORK/collection.json"
GATEWAY="${IPFS_GATEWAY:-https://ipfs.io}"

[ "$(cast chain-id)" = "$CHAIN_ID" ] || die "the $NETWORK RPC endpoint is not serving chain $CHAIN_ID"

call() { cast call "$ADDRESS" "$@"; }

# Asked through ERC-165, so an unreachable endpoint is an error rather than a "no".
supports_reveal() {
  local answer
  answer="$(call "supportsInterface(bytes4)(bool)" 0x49064906)" || die "could not read $ADDRESS on $NETWORK"
  [ "$answer" = "true" ]
}

# The key stays in the environment: Reveal.s.sol reads it itself.
owner_action() {
  forge script script/Reveal.s.sol --rpc-url "$FORGE_RPC" --broadcast --sig "$@"
}

confirm() {
  printf '%s [y/N] ' "$1"
  read -r reply
  [ "$reply" = "y" ] || die "aborted"
}

strip() { sed -E 's/ \[[^]]*\]$//; s/^"(.*)"$/\1/'; }

manifest_field() {
  python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$MANIFEST" "$1"
}

# check <location> <final: 0 or 1>
# Returns 0 when everything matches, 1 when something is wrong, and 2 when nothing is
# wrong but some files could not be fetched.
check() {
  local tsx=generator/node_modules/.bin/tsx
  [ -x "$tsx" ] || die "the generator is not installed. Run: npm --prefix generator ci"
  local final="" quick=""
  if [ "$2" = 1 ]; then final="--final"; fi
  if [ -n "${REVEAL_QUICK:-}" ]; then quick="--quick"; fi
  (cd generator && node_modules/.bin/tsx scripts/check-reveal.ts \
    --network "$NETWORK" --uri "$1" --gateway "$GATEWAY" $final $quick)
}

status() {
  echo "Network        $NETWORK (chain $CHAIN_ID)"
  echo "Contract       $ADDRESS"
  echo "Owner          $(call "owner()(address)")"
  echo "Claim open     $(call "claimOpen()(bool)")"
  echo "Total minted   $(call "totalMinted()(uint256)" | strip)"
  if ! supports_reveal; then
    echo "Reveal         not supported: this contract predates reveal. Redeploy to use it."
    return
  fi
  local revealed
  revealed="$(call "revealedCount()(uint256)" | strip)"
  if [ "$revealed" = 0 ]; then
    echo "Revealed       none yet: every token shows the on-chain placeholder"
  else
    echo "Revealed       tokens 1..$revealed"
  fi
  echo "Base URI       $(call "baseURI()(string)" | strip)"
  echo "Frozen         $(call "metadataFrozen()(bool)")"
  if [ -f "$MANIFEST" ]; then
    python3 - "$MANIFEST" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(f"Generated      tokens 1..{m['count']} at block {m['blockNumber']}, image CID {m['imageCid'] or 'not set yet'}")
PY
  fi
}

publish() {
  local target="${1:-}"
  [ -n "$target" ] || die "usage: scripts/reveal.sh $NETWORK publish <METADATA_CID | https://host/path/>"
  supports_reveal || die "$ADDRESS predates reveal support. Deploy the current contract first."
  [ "$(call "metadataFrozen()(bool)")" = "false" ] || die "the collection is frozen; its metadata can no longer change"
  [ -f "$MANIFEST" ] || die "no $MANIFEST. Generate it first: (cd generator && npm run collection -- --network $NETWORK)"

  local uri
  case "$target" in
    https://*)
      uri="${target%/}/"
      ;;
    http://*)
      [ "$NETWORK" = "anvil" ] || die "use https:// for a public network"
      uri="${target%/}/"
      ;;
    ipfs://*)
      die "pass the bare CID, not an ipfs:// URI"
      ;;
    *)
      printf '%s' "$target" | grep -qE '^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,}|z[1-9A-HJ-NP-Za-km-z]{40,})$' \
        || die "'$target' does not look like an IPFS CID"
      [ "$target" != "$(manifest_field imageCid)" ] || die "that is the image CID. Pass the CID of the uploaded metadata directory."
      uri="ipfs://$target/"
      ;;
  esac

  say "Checking the collection against the chain and the upload"
  local result=0
  check "$uri" 0 || result=$?
  case "$result" in
    0) ;;
    2)
      echo "    A new upload can take a few minutes to reach a public gateway. Try again"
      echo "    later, or set IPFS_GATEWAY to your pinning service's gateway."
      confirm "Publish anyway, without having seen every file?"
      ;;
    *) die "not publishing" ;;
  esac

  local count block minted
  count="$(manifest_field count)"
  block="$(manifest_field blockNumber)"
  minted="$(call "totalMinted()(uint256)" | strip)"
  echo
  echo "Tokens 1..$count (generated at block $block) will read their metadata from"
  echo "  $uri<id>.json"
  if [ "$minted" -gt "$count" ]; then
    echo "Tokens $((count + 1))..$minted were claimed afterwards and keep the placeholder until the next reveal."
  fi
  if [ "$NETWORK" = "sepolia" ]; then
    confirm "Send this transaction on Sepolia?"
  fi

  owner_action "publish(address,string,uint256)" "$ADDRESS" "$uri" "$count"
  echo
  echo "tokenURI(1) is now $(call "tokenURI(uint256)(string)" 1 | strip)"
  echo "Wallets and marketplaces refresh on their own schedule; the contract has told them to (ERC-4906)."
  if [ "$(call "claimOpen()(bool)")" = "false" ] && [ "$count" -eq "$minted" ]; then
    echo "Every token is revealed and claiming is closed. To make it permanent: scripts/reveal.sh $NETWORK freeze"
  fi
}

freeze() {
  supports_reveal || die "$ADDRESS predates reveal support"
  [ "$(call "metadataFrozen()(bool)")" = "false" ] || die "already frozen"
  local minted revealed open uri
  minted="$(call "totalMinted()(uint256)" | strip)"
  revealed="$(call "revealedCount()(uint256)" | strip)"
  open="$(call "claimOpen()(bool)")"
  uri="$(call "baseURI()(string)" | strip)"
  if [ "$revealed" = 0 ] || [ "$revealed" != "$minted" ]; then
    die "only tokens 1..$revealed of $minted are revealed. Close claiming, generate and publish again, then freeze:
    scripts/reveal.sh $NETWORK close
    (cd generator && npm run collection -- --network $NETWORK)   # then upload and publish"
  fi
  [ -f "$MANIFEST" ] || die "no $MANIFEST to check the published collection against. Generate it again first."

  say "Checking what freezing would make permanent"
  local result=0
  check "$uri" 1 || result=$?
  case "$result" in
    0) ;;
    2) confirm "Some files could not be fetched, so the upload is not fully confirmed. Freeze anyway?" ;;
    *) die "not freezing until the problems above are fixed. If $MANIFEST is not the collection that was
    published, generate it again and set the published image CID." ;;
  esac

  echo
  echo "Freezing makes $uri permanent for all $minted tokens."
  if [ "$open" = "true" ]; then
    echo "Claiming is open now; freezing closes it, and it can never reopen."
  fi
  echo "This cannot be undone."
  printf 'Type "freeze" to continue: '
  read -r reply
  [ "$reply" = "freeze" ] || die "aborted"
  owner_action "freeze(address)" "$ADDRESS"
}

case "$ACTION" in
  status) status ;;
  publish) publish "${3:-}" ;;
  close) owner_action "setClaimOpen(address,bool)" "$ADDRESS" false ;;
  open) owner_action "setClaimOpen(address,bool)" "$ADDRESS" true ;;
  freeze) freeze ;;
esac
