# Shared by the shell scripts in this directory. Source it, from the repository root.

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Sets CHAIN_ID for a network name. Only Sepolia and a local node are supported.
use_network() {
  case "$1" in
    sepolia) CHAIN_ID=11155111 ;;
    anvil|localhost) CHAIN_ID=31337 ;;
    *) die "unknown network '$1'. Expected sepolia or anvil." ;;
  esac
}

# load_env <network> <need-key: 0 or 1>
#
# Sets RPC_URL and FORGE_RPC for the network and, when asked, a checked
# DEPLOYER_PRIVATE_KEY.
#
# Nothing secret goes on a command line, where other processes can read it: cast
# takes the endpoint from ETH_RPC_URL, forge takes Sepolia's through the `sepolia`
# alias in foundry.toml, and forge reads the key and ETHERSCAN_API_KEY from the
# environment.
# .env fills in only what the environment has not already provided, so an explicit
# `REQUIRE_ALLOWLIST=true scripts/deploy.sh sepolia`, or a local Anvil key, is never
# silently replaced by whatever the file says.
load_env() {
  local network="$1" need_key="$2"

  if [ -f .env ]; then
    local key explicit=""
    for key in $(sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)=.*/\2/p' .env); do
      if [ -n "${!key:-}" ]; then
        explicit="${explicit}${key}=$(printf '%q' "${!key}")
"
      fi
    done
    set -a; . ./.env; set +a
    eval "$explicit"
  elif [ "$network" = "sepolia" ]; then
    die "no .env file. Copy .env.example to .env and fill it in."
  fi

  if [ "$network" = "sepolia" ]; then
    [ -n "${SEPOLIA_RPC_URL:-}" ] || die "SEPOLIA_RPC_URL is not set in .env"
    export SEPOLIA_RPC_URL
    RPC_URL="$SEPOLIA_RPC_URL"
    FORGE_RPC=sepolia
  else
    RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
    export ANVIL_RPC_URL="$RPC_URL"
    FORGE_RPC="$RPC_URL"
  fi
  export ETH_RPC_URL="$RPC_URL"
  if [ -n "${ETHERSCAN_API_KEY:-}" ]; then export ETHERSCAN_API_KEY; fi

  [ "$need_key" = 1 ] || return 0
  if [ "$network" = "sepolia" ]; then
    [ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "DEPLOYER_PRIVATE_KEY is not set in .env"
  else
    [ -n "${DEPLOYER_PRIVATE_KEY:-}" ] || die "set DEPLOYER_PRIVATE_KEY to an Anvil key for local use"
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
}

# record_field <network> <field>: one value from deployments/<network>.json.
record_field() {
  python3 - "deployments/$1.json" "$2" <<'PY'
import json, sys
path, field = sys.argv[1], sys.argv[2]
try:
    value = json.load(open(path)).get(field)
except FileNotFoundError:
    raise SystemExit(f"no {path}")
print("" if value is None else value)
PY
}
