#!/usr/bin/env bash
# Read-only smoke test of a deployment: health, and that signed-out visitors and ended sessions get no
# pages and no server actions. Nothing is signed in and no action runs: every write below is refused
# before it reaches the app. Exit code 0 only if every check passes.
#
#   scripts/smoke-auth.sh https://abm-chi.vercel.app
set -uo pipefail
B="${1:?base URL, e.g. https://abm-chi.vercel.app}"
ENDED="Cookie: abm_session=smoke.invalid"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected '$3', got '$2')"; fail=1; fi; }
head_of() { curl -s -o /dev/null -D - -m 30 "$@" | tr -d '\r'; }
all_of() { curl -s -D - -m 30 "$@" | tr -d '\r'; }
status() { awk 'NR==1 || /^HTTP\//{s=$2} END{print s}'; }
header() { awk -v h="$1" 'tolower($1)==tolower(h)":"{sub(/^[^:]+: */, ""); print; exit}'; }
cleared() { grep -ciE '^set-cookie: abm_session=[^;]*;.*max-age=0' | tr -d ' '; }
action=(-X POST -H "Next-Action: 0000000000" -H "Content-Type: text/plain;charset=UTF-8" --data '[]')

check "health answers ok" "$(curl -s -m 30 "$B/api/v1/health" | grep -o '"ok":true')" '"ok":true'
r=$(head_of "$B/accounts")
check "signed out: a page sends to sign-in" "$(echo "$r" | status) $(echo "$r" | header location)" "307 /login?next=%2Faccounts"
r=$(head_of -H "$ENDED" "$B/accounts")
check "ended session: a page sends to sign-in, saying why" "$(echo "$r" | status) $(echo "$r" | header location)" "307 /login?next=%2Faccounts&e=ended"
check "ended session: the cookie is cleared" "$(echo "$r" | cleared)" "1"
r=$(head_of "$B/login")
check "the sign-in page opens" "$(echo "$r" | status)" "200"
r=$(head_of -H "$ENDED" "$B/login")
check "the sign-in page opens for an ended session and clears it" "$(echo "$r" | status) $(echo "$r" | cleared)" "200 1"
r=$(all_of "${action[@]}" "$B/accounts")
check "signed out: a server action is refused" "$(echo "$r" | status) $(echo "$r" | grep -o '"error":"[a-z_]*"')" '401 "error":"sign_in_required"'
check "signed out: the action client is sent to sign-in" "$(echo "$r" | header x-action-redirect)" "/login?next=%2Faccounts;replace"
r=$(all_of -H "$ENDED" "${action[@]}" "$B/accounts")
check "ended session: a server action is refused and the cookie cleared" "$(echo "$r" | status) $(echo "$r" | grep -o '"error":"[a-z_]*"') $(echo "$r" | cleared)" '401 "error":"session_ended" 1'
r=$(all_of -H "$ENDED" -X POST --data 'x=1' "$B/accounts")
check "ended session: any other write is refused" "$(echo "$r" | status) $(echo "$r" | grep -o '"error":"[a-z_]*"')" '401 "error":"session_ended"'
check "the API refuses a request without a key" "$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$B/api/v1/accounts")" "401"
[ "$fail" = 0 ] && echo "All checks passed." || echo "Some checks FAILED."
exit "$fail"
