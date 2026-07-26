#!/usr/bin/env bash
#
# index-token.sh — stream recent ERC-20 transfers for one token on one EVM chain,
# using a prebuilt Substreams package. No Rust, no build step, no deploy.
#
# Usage:
#   ./index-token.sh --chain worldchain --token 0x79A0...24D1 [--blocks 50] [--json out.json]
#
# See README.md for prerequisites and the auth token this needs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAINS_JSON="${SCRIPT_DIR}/../chains.json"

# Prebuilt, publicly downloadable ERC-20 package. Pinned by version on purpose:
# an unpinned "latest" would change the output schema under the caller.
SPKG="${SUBSTREAMS_SPKG:-https://spkg.io/streamingfast/erc20-balance-changes-v1.2.0.spkg}"
MODULE="${SUBSTREAMS_MODULE:-map_balance_changes}"

CHAIN=""; TOKEN=""; BLOCKS=50; START=""; ENDPOINT=""; RPC=""; JSON_OUT=""; RAW=0

die() { echo "error: $*" >&2; exit 1; }
note() { echo "$*" >&2; }

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --chain)    CHAIN="${2:-}"; shift 2 ;;
    --token)    TOKEN="${2:-}"; shift 2 ;;
    --blocks)   BLOCKS="${2:-}"; shift 2 ;;
    --start)    START="${2:-}"; shift 2 ;;
    --endpoint) ENDPOINT="${2:-}"; shift 2 ;;
    --rpc)      RPC="${2:-}"; shift 2 ;;
    --json)     JSON_OUT="${2:-}"; shift 2 ;;
    --raw)      RAW=1; shift ;;
    -h|--help)  usage 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

# ---- preflight: fail loudly, with the fix, before touching the network -------

command -v substreams >/dev/null 2>&1 || die \
"the 'substreams' CLI is not installed.
  macOS: brew install streamingfast/tap/substreams
  other: https://docs.substreams.dev/how-to-guides/installing-the-cli"

command -v jq >/dev/null 2>&1 || die "'jq' is not installed (brew install jq)."

if [ -z "${SUBSTREAMS_API_KEY:-}" ] && [ -z "${SUBSTREAMS_API_TOKEN:-}" ]; then
  die \
"no Substreams credential in the environment.

  Every Substreams endpoint requires auth — there is no free anonymous tier.
  Get a key (free tier available) at https://thegraph.market, then:

      export SUBSTREAMS_API_KEY=<your key>

  The CLI also accepts a JWT in SUBSTREAMS_API_TOKEN; 'substreams auth' will
  mint one from the same key."
fi

[ -n "$CHAIN" ] || die "--chain is required (try --help)"
[ -f "$CHAINS_JSON" ] || die "chain registry not found at $CHAINS_JSON"

# ---- resolve the chain ------------------------------------------------------

UNSUPPORTED="$(jq -r --arg c "$CHAIN" '.unsupported[$c] // empty' "$CHAINS_JSON")"
[ -z "$UNSUPPORTED" ] || die "chain '$CHAIN' is not usable with this skill.
  $UNSUPPORTED"

if [ -z "$ENDPOINT" ]; then
  ENDPOINT="$(jq -r --arg c "$CHAIN" '.chains[$c].substreams // empty' "$CHAINS_JSON")"
fi
if [ -z "$RPC" ]; then
  RPC="$(jq -r --arg c "$CHAIN" '.chains[$c].rpc // empty' "$CHAINS_JSON")"
fi

if [ -z "$ENDPOINT" ]; then
  KNOWN="$(jq -r '.chains | keys | join(", ")' "$CHAINS_JSON")"
  die "unknown chain '$CHAIN'.
  Known chains: $KNOWN
  If Substreams has since added yours, pass --endpoint host:port --rpc URL,
  and check https://docs.substreams.dev/reference-material/chain-support/chains-and-endpoints"
fi

# ---- pick a start block near the head ---------------------------------------

if [ -z "$START" ]; then
  [ -n "$RPC" ] || die "no RPC for '$CHAIN'; pass --start <block> or --rpc <url>"
  HEAD_HEX="$(curl -s --max-time 15 -X POST "$RPC" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
    | jq -r '.result // empty')"
  [ -n "$HEAD_HEX" ] || die "could not read head block from $RPC — pass --start <block>"
  HEAD=$((HEAD_HEX))
  # Stay a few blocks behind the head: the very tip may not be indexed yet.
  START=$(( HEAD - BLOCKS - 5 ))
  note "head block on $CHAIN: $HEAD"
fi

note "streaming $BLOCKS blocks from $START on $CHAIN ($ENDPOINT)"
[ -n "$TOKEN" ] && note "filtering to token $TOKEN"

# ---- stream -----------------------------------------------------------------

RAW_OUT="$(mktemp)"
trap 'rm -f "$RAW_OUT"' EXIT

if ! substreams run "$SPKG" "$MODULE" \
      -e "$ENDPOINT" -s "$START" -t "+$BLOCKS" \
      --output json >"$RAW_OUT" 2>"${RAW_OUT}.err"; then
  note "--- substreams stderr ---"
  cat "${RAW_OUT}.err" >&2
  rm -f "${RAW_OUT}.err"
  die "the stream failed (see above). If it says Unauthenticated, your key is
  missing or not entitled to this chain: https://thegraph.market"
fi
rm -f "${RAW_OUT}.err"

if [ "$RAW" = "1" ]; then
  cat "$RAW_OUT"
  exit 0
fi

# `substreams run --output json` emits one JSON object per block; module payload
# sits under @data. Field names are the erc20.types.v1.BalanceChange proto,
# lowerCamelCased by the JSON printer.
# The proto emits addresses as bare hex with no 0x prefix, while every explorer, every
# doc and every human writes them with one. Comparing the two forms silently matches
# nothing — and this script then reports "0 matching balance changes… that is a real
# result, not an error", which is the most confidently wrong thing it could say. Both
# sides are normalised to bare lowercase hex before comparison, and the 0x is put back on
# the way out so the output pastes into a block explorer.
TOKEN_LC="$(printf '%s' "$TOKEN" | tr '[:upper:]' '[:lower:]' | sed 's/^0x//')"

# `substreams run` writes a plain-text trailer ("Completed successfully") to stdout after
# the JSON stream, which makes `jq -s` fail with a parse error thousands of lines from the
# real content.
CLEAN_OUT="$(mktemp)"
trap 'rm -f "$RAW_OUT" "$CLEAN_OUT"' EXIT
# Pretty-printed JSON never begins a line with a letter at column 0, so status text is
# separable without parsing it.
grep -vE '^[A-Za-z]' "$RAW_OUT" | sed -E '/^[[:space:]]*$/d' > "$CLEAN_OUT"

TRANSFERS="$(jq -s --arg token "$TOKEN_LC" '
  [ .[]
    | select(.["@data"].balanceChanges != null)
    | . as $blk
    | $blk["@data"].balanceChanges[]
    | select($token == "" or ((.contract | ascii_downcase | ltrimstr("0x")) == $token))
    | {
        block:    ($blk["@block"] // $blk.clock.number // null),
        contract: ("0x" + (.contract | ascii_downcase | ltrimstr("0x"))),
        owner:    ("0x" + (.owner | ascii_downcase | ltrimstr("0x"))),
        tx:       .transaction,
        value:    .transferValue,
        oldBalance: .oldBalance,
        newBalance: .newBalance,
        changeType: .changeType
      }
  ]' "$CLEAN_OUT")"

COUNT="$(printf '%s' "$TRANSFERS" | jq 'length')"

if [ -n "$JSON_OUT" ]; then
  printf '%s\n' "$TRANSFERS" > "$JSON_OUT"
  note "wrote $COUNT records to $JSON_OUT"
fi

printf '%s\n' "$TRANSFERS"

if [ "$COUNT" = "0" ]; then
  note ""
  note "0 matching balance changes in blocks $START..$((START + BLOCKS))."
  note "That is a real result, not an error — the token may simply not have moved"
  note "in that window. Widen with --blocks, or drop --token to see all tokens."
fi
