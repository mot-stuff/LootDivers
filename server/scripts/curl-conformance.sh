#!/usr/bin/env bash
# Manual §2 contract conformance probe (TASK-707 acceptance criterion 3).
# Exercises every contract row against a running API with plain curl.
#
# Usage:
#   BASE_URL=https://api.<yourdomain.com> ./scripts/curl-conformance.sh
#   BASE_URL=http://localhost:3000 ./scripts/curl-conformance.sh   # local dev
#
# Creates one throwaway account per run (timestamped email). Safe to re-run.

set -uo pipefail

BASE_URL="${BASE_URL:?set BASE_URL to the API origin}"
JAR_A="$(mktemp)"
JAR_B="$(mktemp)"
EMAIL_A="conformance-$(date +%s)-a@example.test"
EMAIL_B="conformance-$(date +%s)-b@example.test"
PASSWORD="conformance password 1"
FAILURES=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "${expected}" = "${actual}" ]; then
    echo "PASS  ${label} (${actual})"
  else
    echo "FAIL  ${label}: expected ${expected}, got ${actual}"
    FAILURES=$((FAILURES + 1))
  fi
}

status() {
  # status <jar> <method> <path> [json-body]
  local jar="$1" method="$2" path="$3" body="${4:-}"
  if [ -n "${body}" ]; then
    curl -s -o /tmp/conformance-body.json -w "%{http_code}" \
      -X "${method}" -H "Content-Type: application/json" \
      -b "${jar}" -c "${jar}" -d "${body}" "${BASE_URL}${path}"
  else
    curl -s -o /tmp/conformance-body.json -w "%{http_code}" \
      -X "${method}" -b "${jar}" -c "${jar}" "${BASE_URL}${path}"
  fi
}

# A shape-valid envelope with a bogus checksum. Since TASK-717 (DEC-043) the
# server validates envelope CONTENTS on save, so this probe is rejected with
# 422 checksum-mismatch — curl cannot sign a real save. The accepted-save
# path (200) and the tamper matrix are covered by the contract test suite
# (server/test/contract-suite.ts), which builds real signed envelopes.
ENVELOPE='{"format":"rarpg-character-save","formatVersion":1,"saveId":"character:slot-1","revision":1,"createdAt":"2026-09-05T00:00:00.000Z","updatedAt":"2026-09-05T00:00:00.000Z","compatibility":{"build":"curl","contentSchemaVersion":1},"migrationProvenance":[],"payload":{"probe":true},"checksum":{"algorithm":"SHA-256","value":"abab"}}'

check "GET /healthz" 200 "$(status "${JAR_A}" GET /healthz)"

check "signup A" 201 "$(status "${JAR_A}" POST /auth/signup "{\"email\":\"${EMAIL_A}\",\"password\":\"${PASSWORD}\"}")"
check "signup duplicate email" 409 "$(status "${JAR_B}" POST /auth/signup "{\"email\":\"${EMAIL_A}\",\"password\":\"${PASSWORD}\"}")"
check "signup invalid email" 422 "$(status "${JAR_B}" POST /auth/signup '{"email":"nope","password":"long enough pw"}')"
check "session probe A" 200 "$(status "${JAR_A}" GET /auth/session)"
check "login wrong password" 401 "$(status "${JAR_B}" POST /auth/login "{\"email\":\"${EMAIL_A}\",\"password\":\"wrong password!\"}")"
check "signup B" 201 "$(status "${JAR_B}" POST /auth/signup "{\"email\":\"${EMAIL_B}\",\"password\":\"${PASSWORD}\"}")"

check "create character" 201 "$(status "${JAR_A}" POST /characters '{"name":"Conformance","class":"barbarian"}')"
CHARACTER_ID="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' /tmp/conformance-body.json)"
check "create invalid name" 422 "$(status "${JAR_A}" POST /characters '{"name":"x","class":"barbarian"}')"
check "create duplicate name (case-insensitive)" 409 "$(status "${JAR_A}" POST /characters '{"name":"conformance","class":"barbarian"}')"
check "create invalid class" 422 "$(status "${JAR_A}" POST /characters '{"name":"Other Name","class":"wizard"}')"
check "list characters" 200 "$(status "${JAR_A}" GET /characters)"
check "get character (envelope null)" 200 "$(status "${JAR_A}" GET "/characters/${CHARACTER_ID}")"

check "save forged checksum rejected (DEC-043)" 422 "$(status "${JAR_A}" PUT "/characters/${CHARACTER_ID}/save" "{\"envelope\":${ENVELOPE},\"level\":3}")"
check "save malformed envelope" 422 "$(status "${JAR_A}" PUT "/characters/${CHARACTER_ID}/save" '{"envelope":{"nope":true},"level":3}')"
BIG_BLOB="$(head -c 1100000 /dev/zero | tr '\0' 'x')"
check "save oversized envelope" 413 "$(status "${JAR_A}" PUT "/characters/${CHARACTER_ID}/save" "{\"envelope\":$(echo "${ENVELOPE}" | sed "s/{\"probe\":true}/{\"probe\":\"${BIG_BLOB}\"}/"),\"level\":3}")"

check "ownership: B reads A's character" 404 "$(status "${JAR_B}" GET "/characters/${CHARACTER_ID}")"
# Content validation precedes the ownership lookup, so an unsigned probe gets
# 422 here too; B-with-a-VALID-envelope 404 is pinned by the contract suite.
check "ownership: B saves A's character (unsigned probe)" 422 "$(status "${JAR_B}" PUT "/characters/${CHARACTER_ID}/save" "{\"envelope\":${ENVELOPE},\"level\":9}")"
check "ownership: B deletes A's character" 404 "$(status "${JAR_B}" DELETE "/characters/${CHARACTER_ID}")"

# Slot limit: A already has 1; three more fill the account, the fifth fails.
check "slot 2" 201 "$(status "${JAR_A}" POST /characters '{"name":"Slot Two","class":"barbarian"}')"
check "slot 3" 201 "$(status "${JAR_A}" POST /characters '{"name":"Slot Three","class":"barbarian"}')"
check "slot 4" 201 "$(status "${JAR_A}" POST /characters '{"name":"Slot Four","class":"barbarian"}')"
check "slot limit" 403 "$(status "${JAR_A}" POST /characters '{"name":"Slot Five","class":"barbarian"}')"

check "delete character" 204 "$(status "${JAR_A}" DELETE "/characters/${CHARACTER_ID}")"
check "get deleted character" 404 "$(status "${JAR_A}" GET "/characters/${CHARACTER_ID}")"
check "logout" 204 "$(status "${JAR_A}" POST /auth/logout)"
check "session after logout" 401 "$(status "${JAR_A}" GET /auth/session)"

rm -f "${JAR_A}" "${JAR_B}" /tmp/conformance-body.json

echo
if [ "${FAILURES}" -eq 0 ]; then
  echo "All conformance checks passed."
else
  echo "${FAILURES} conformance check(s) FAILED."
  exit 1
fi
