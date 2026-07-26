#!/usr/bin/env bash
#
# Razorpay capability probe — which products are actually enabled on the account.
#
#   npm run razorpay:probe
#
# Reads test keys from .env.local / .env.development.local. Never echoes secret
# values, and refuses to run against a live key.
#
# Every request is read-only or deliberately invalid. Nothing is created.
#
# WHY THIS EXISTS
# ---------------
# On 2026-07-26 this probe found that Razorpay Route was not enabled on the
# account: /v1/payments and /v1/refunds returned 200, but every Route endpoint
# returned "The requested URL was not found on the server". That means
# createLinkedAccount() and createHeldTransfer() in src/lib/razorpay.js target
# endpoints that cannot succeed — campaign funding works, clipper payouts do not.
#
# Re-run this after Razorpay support enables Route to confirm what landed.
# See AGENTS.md and docs/product/08-monetisation.md.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

getval() {
  local key="$1" out="" v
  for f in .env.local .env.development.local; do
    [ -f "$f" ] || continue
    v=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$f" 2>/dev/null \
        | tail -1 | sed -E "s/^[^=]*=//; s/^[\"']//; s/[\"']\$//; s/\r\$//")
    [ -n "$v" ] && out="$v"
  done
  printf '%s' "$out"
}

KID=$(getval RAZORPAY_TEST_KEY_ID)
KSEC=$(getval RAZORPAY_TEST_KEY_SECRET)
if [ -z "$KID" ] || [ -z "$KSEC" ]; then
  KID=$(getval RAZORPAY_KEY_ID)
  KSEC=$(getval RAZORPAY_KEY_SECRET)
fi

if [ -z "$KID" ] || [ -z "$KSEC" ]; then
  echo "ABORT: no Razorpay key id/secret found in .env.local"
  exit 1
fi

# Safety gate — this script must never touch a live account.
case "$KID" in
  rzp_test_*) echo "key mode: TEST (ok)" ;;
  rzp_live_*) echo "ABORT: key is LIVE mode. Refusing to run."; exit 1 ;;
  *)          echo "ABORT: unrecognised key id prefix. Refusing to run."; exit 1 ;;
esac

AUTH="${KID}:${KSEC}"
API="https://api.razorpay.com"

# Prints: label, HTTP status, and a verdict.
probe() {
  local label="$1" method="$2" url="$3" body="${4:-}"
  local out code
  if [ -n "$body" ]; then
    out=$(curl -sS -u "$AUTH" -X "$method" "$url" \
          -H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}')
  else
    out=$(curl -sS -u "$AUTH" -X "$method" "$url" -w '\n%{http_code}')
  fi
  code=$(printf '%s' "$out" | tail -1)
  local payload; payload=$(printf '%s' "$out" | sed '$d')

  printf '%-38s HTTP %-4s ' "$label" "$code"
  case "$payload" in
    *"requested URL was not found"*|*"no Route matched"*)
      echo "✗ NOT ENABLED on this account" ;;
    *"Access to requested resource not available"*)
      echo "✗ not authorised for this account" ;;
    *"not enabled"*|*"not activated"*)
      echo "✗ feature not activated" ;;
    *)
      if [ "$code" = "200" ]; then echo "✓ reachable"
      else echo "→ reachable (expected failure: bad id / validation)"; fi ;;
  esac
}

echo
echo "── Core payments (should be reachable) ────────────────────────────"
probe "GET  /v1/payments"            GET  "$API/v1/payments?count=1"
probe "GET  /v1/settlements"         GET  "$API/v1/settlements?count=1"
probe "GET  /v1/refunds"             GET  "$API/v1/refunds?count=1"

echo
echo "── Route (needed for clipper payouts) ─────────────────────────────"
probe "GET  /v2/accounts"            GET  "$API/v2/accounts?count=1"
probe "GET  /v1/transfers"           GET  "$API/v1/transfers?count=1"

echo
echo "── Direct Transfers (needed for the wallet model) ─────────────────"
echo "   Invalid account id on purpose — distinguishes 'feature off' from"
echo "   'bad account'. Creates nothing either way."
probe "POST /v1/transfers"           POST "$API/v1/transfers" \
      '{"account":"acc_INVALIDPROBE0","amount":10000,"currency":"INR"}'

echo
echo "── RazorpayX Payouts (fallback path only) ─────────────────────────"
probe "GET  /v1/payouts"             GET  "$API/v1/payouts?count=1"

echo
echo "Reference: docs/product/08-monetisation.md, docs/product/sql/README.md"
