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
# The whole sequence (README, "Reveal"):
#   cd generator && npm run collection -- --network sepolia
#   upload images/, npm run set-image-cid, upload metadata/
#   scripts/reveal.sh sepolia publish <METADATA_CID>
#
# `publish` refuses to point the contract anywhere until it has fetched the uploaded
# files back and found them identical to the generated ones.
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

# cast reads the endpoint from here, which keeps it out of the process list.
export ETH_RPC_URL="$RPC_URL"
MANIFEST="generator/output/collection/$NETWORK/collection.json"
GATEWAY="${IPFS_GATEWAY:-https://ipfs.io}"

[ "$(cast chain-id)" = "$CHAIN_ID" ] || die "the $NETWORK RPC endpoint is not serving chain $CHAIN_ID"

call() { cast call "$ADDRESS" "$@"; }

supports_reveal() { call "revealedCount()(uint256)" >/dev/null 2>&1; }

# The key stays in the environment: Reveal.s.sol reads it itself.
owner_action() {
  forge script script/Reveal.s.sol --rpc-url "$RPC_URL" --broadcast --sig "$@"
}

confirm() {
  printf '%s [y/N] ' "$1"
  read -r reply
  [ "$reply" = "y" ] || die "aborted"
}

strip() { sed -E 's/ \[[^]]*\]$//; s/^"(.*)"$/\1/'; }

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

# Everything publish needs from the generated collection, after checking it.
read_manifest() {
  [ -f "$MANIFEST" ] || die "no $MANIFEST. Generate it first: (cd generator && npm run collection -- --network $NETWORK)"
  python3 - "$MANIFEST" "$ADDRESS" "$CHAIN_ID" <<'PY'
import json, os, sys
path, address, chain_id = sys.argv[1], sys.argv[2], int(sys.argv[3])
m = json.load(open(path))
root = os.path.dirname(path)

def fail(message):
    raise SystemExit(f"error: {message}")

if m["contract"].lower() != address.lower() or m["chainId"] != chain_id:
    fail(f"{path} was generated for {m['contract']} on chain {m['chainId']}, not {address}")
cid = m.get("imageCid")
if not cid:
    fail("the image CID is not set. Upload images/, then: npm run set-image-cid -- "
         f"--dir output/collection/{m['network']} --cid <IMAGE_CID>")
names = sorted(os.listdir(os.path.join(root, "metadata")))
expected = sorted(f"{i}.json" for i in range(1, m["count"] + 1))
if names != expected:
    fail(f"metadata/ should hold exactly 1.json..{m['count']}.json")
for name in names:
    token = name[:-5]
    image = json.load(open(os.path.join(root, "metadata", name)))["image"]
    if image != f"ipfs://{cid}/{token}.png":
        fail(f"metadata/{name} points at {image}, not the uploaded images")
print(m["count"], cid, m["tokens"][-1]["imageSha256"], m["blockNumber"])
PY
}

# fetch <url> <file>: true if the URL could be downloaded.
fetch() { curl -fsSL --max-time "${FETCH_TIMEOUT:-90}" -o "$2" "$1" 2>/dev/null; }

same_json() {
  python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))' "$1" "$2"
}

publish() {
  local target="${1:-}"
  [ -n "$target" ] || die "usage: scripts/reveal.sh $NETWORK publish <METADATA_CID | https://host/path/>"
  supports_reveal || die "$ADDRESS predates reveal support. Deploy the current contract first."
  [ "$(call "metadataFrozen()(bool)")" = "false" ] || die "the collection is frozen; its metadata can no longer change"

  local info count image_cid last_sha block
  info="$(read_manifest)" || exit 1
  read -r count image_cid last_sha block <<<"$info"

  local uri base
  case "$target" in
    https://*|http://*)
      case "$target" in
        http://*) [ "$NETWORK" = "anvil" ] || die "use https:// for a public network" ;;
      esac
      uri="${target%/}/"
      base="$uri"
      ;;
    ipfs://*)
      die "pass the bare CID, not an ipfs:// URI"
      ;;
    *)
      printf '%s' "$target" | grep -qE '^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,}|z[1-9A-HJ-NP-Za-km-z]{40,})$' \
        || die "'$target' does not look like an IPFS CID"
      [ "$target" != "$image_cid" ] || die "that is the image CID. Pass the CID of the uploaded metadata directory."
      uri="ipfs://$target/"
      base="$GATEWAY/ipfs/$target/"
      ;;
  esac

  local minted
  minted="$(call "totalMinted()(uint256)" | strip)"
  [ "$count" -le "$minted" ] || die "the collection has $count tokens but the contract has minted only $minted"

  # Read the upload back before pointing anything at it: the last token's metadata
  # and image, compared with what was generated.
  say "Checking the upload at $base"
  SCRATCH="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH"' EXIT
  local problems=0
  if fetch "${base}${count}.json" "$SCRATCH/meta.json"; then
    if same_json "$SCRATCH/meta.json" "generator/output/collection/$NETWORK/metadata/$count.json"; then
      echo "    metadata/$count.json matches"
    else
      die "the uploaded $count.json differs from the generated one. Upload generator/output/collection/$NETWORK/metadata again."
    fi
  else
    warn "could not fetch ${base}${count}.json"
    problems=1
  fi
  if fetch "$GATEWAY/ipfs/$image_cid/$count.png" "$SCRATCH/image.png"; then
    if [ "$(shasum -a 256 "$SCRATCH/image.png" | cut -d' ' -f1)" = "$last_sha" ]; then
      echo "    images/$count.png matches"
    else
      die "the uploaded image $count.png differs from the generated one. Upload generator/output/collection/$NETWORK/images again."
    fi
  else
    warn "could not fetch $GATEWAY/ipfs/$image_cid/$count.png"
    problems=1
  fi
  if [ "$problems" -eq 1 ]; then
    echo "    New uploads can take a few minutes to reach a public gateway. Retry later, or"
    echo "    set IPFS_GATEWAY to your pinning service's gateway."
    confirm "Publish anyway, without having seen the upload?"
  fi

  echo
  echo "Tokens 1..$count (generated at block $block) will read their metadata from"
  echo "  $uri<id>.json"
  if [ "$minted" -gt "$count" ]; then
    echo "Tokens $((count + 1))..$minted were claimed afterwards and keep the placeholder until the next reveal."
  fi
  [ "$NETWORK" = "sepolia" ] && confirm "Send this transaction on Sepolia?"

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
  local minted revealed open uri
  minted="$(call "totalMinted()(uint256)" | strip)"
  revealed="$(call "revealedCount()(uint256)" | strip)"
  open="$(call "claimOpen()(bool)")"
  uri="$(call "baseURI()(string)" | strip)"
  [ "$(call "metadataFrozen()(bool)")" = "false" ] || die "already frozen"
  if [ "$revealed" = 0 ] || [ "$revealed" != "$minted" ]; then
    die "only tokens 1..$revealed of $minted are revealed. Close claiming, generate and publish again, then freeze:
    scripts/reveal.sh $NETWORK close
    (cd generator && npm run collection -- --network $NETWORK)   # then upload and publish"
  fi

  echo "Freezing makes $uri permanent for all $minted tokens."
  [ "$open" = "true" ] && echo "Claiming is open now; freezing closes it, and it can never reopen."
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
