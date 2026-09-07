#!/bin/sh
# End-to-end smoke test against a running stack (docker compose up -d backend).
# Reads BACKEND=http://localhost:8080 by default. Exits non-zero on any failure.
set -eu
BACKEND="${BACKEND:-http://localhost:8080}"
j() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d'"$1"')'; }

echo "== health =="
curl -fsS "$BACKEND/api/health" | tee /dev/stderr | grep -q '"database":"ok"'

echo "== register admin =="
U="admin_$(date +%s)"
REG=$(curl -fsS -X POST "$BACKEND/api/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$U@example.com\",\"username\":\"$U\",\"password\":\"Sup3rSecret!!\"}")
ACCESS=$(printf '%s' "$REG" | j "['access_token']")
REFRESH=$(printf '%s' "$REG" | j "['refresh_token']")
printf '%s' "$REG" | grep -q '"role":"admin"' && echo "  first user is admin: ok"

echo "== me =="
curl -fsS "$BACKEND/api/auth/me" -H "Authorization: Bearer $ACCESS" | grep -q "\"username\":\"$U\""

echo "== refresh rotation =="
NEW=$(curl -fsS -X POST "$BACKEND/api/auth/refresh" -H 'content-type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
printf '%s' "$NEW" | j "['access_token']" >/dev/null
curl -fsS -o /dev/null -w '%{http_code}' -X POST "$BACKEND/api/auth/refresh" \
  -H 'content-type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}" | grep -q 401 \
  && echo "  reused refresh rejected: ok"

echo "== profile crud =="
PID=$(curl -fsS -X POST "$BACKEND/api/profiles" -H "Authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' -d '{"name":"Ingenieria","configuration":{"formacion":["x"]}}' | j "['id']")
curl -fsS "$BACKEND/api/profiles/$PID" -H "Authorization: Bearer $ACCESS" | grep -q '"is_primary":true'

echo "== credential store =="
curl -fsS "$BACKEND/api/credentials/store-status" | grep -q '"configured":true'
CID=$(curl -fsS -X POST "$BACKEND/api/credentials" -H "Authorization: Bearer $ACCESS" \
  -H 'content-type: application/json' \
  -d '{"provider":"telegram","name":"bot","type":"api_key","secret":{"token":"123:ABC"}}' | j "['id']")
GET=$(curl -fsS "$BACKEND/api/credentials/$CID" -H "Authorization: Bearer $ACCESS")
printf '%s' "$GET" | grep -q 'encrypted_data' && { echo "LEAK: encrypted_data in response"; exit 1; }
printf '%s' "$GET" | grep -q '123:ABC' && { echo "LEAK: secret in response"; exit 1; }
echo "  secret not exposed: ok"

echo "== n8n health (key optional) =="
curl -fsS "$BACKEND/api/n8n/health" -H "Authorization: Bearer $ACCESS" | tee /dev/stderr | grep -q '"reachable":true'

echo "== ai layer =="
# Deploy-drift canary: a mounted endpoint refuses an anonymous caller (401);
# an image built before the AI layer answers 404. That single digit is the
# difference between "sign in" and "this backend has no AI API".
ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BACKEND/api/ai/providers")
if [ "$ANON" = "404" ]; then
  echo "  FAIL: /api/ai/providers is not served by this build (stale deployment?)"
  exit 1
fi
[ "$ANON" = "401" ] && echo "  anonymous call refused, not missing: ok"

PROVIDERS=$(curl -fsS "$BACKEND/api/ai/providers" -H "Authorization: Bearer $ACCESS")
for P in nvidia_nim openrouter gemini; do
  printf '%s' "$PROVIDERS" | grep -q "\"id\":\"$P\"" || { echo "  MISSING provider: $P"; exit 1; }
done
echo "  providers: nvidia_nim, openrouter, gemini: ok"
printf '%s' "$PROVIDERS" | grep -q '"api_key"' && { echo "LEAK: api_key in the provider catalogue"; exit 1; }
# Key SHAPES, not prefixes: `key_help` legitimately reads "... (nvapi-...)",
# and flagging that would cry wolf on help text.
printf '%s' "$PROVIDERS" | grep -qE 'nvapi-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9]{8,}|AIzaSy[A-Za-z0-9_-]{10,}'   && { echo "LEAK: a provider key in the response"; exit 1; }
echo "  no credential in the catalogue: ok"

curl -fsS "$BACKEND/api/ai/config" -H "Authorization: Bearer $ACCESS" | grep -q '"fallback_enabled"'   && echo "  config carries the fallback settings: ok"
curl -fsS "$BACKEND/api/ai/health" -H "Authorization: Bearer $ACCESS" | tee /dev/stderr | grep -q '"status"'   && echo "  health answers: ok"

echo "== websocket /ws/monitor =="
python3 - "$BACKEND" "$ACCESS" <<'PY'
import sys, json, asyncio
try:
    import websockets
except ImportError:
    print("  (websockets lib not present, skipping ws check)"); sys.exit(0)
base = sys.argv[1].replace("http", "ws"); tok = sys.argv[2]
async def main():
    async with websockets.connect(f"{base}/ws/monitor?token={tok}") as ws:
        hello = json.loads(await ws.recv()); assert hello["type"] == "hello"
        types = set()
        for _ in range(8):
            types.add(json.loads(await asyncio.wait_for(ws.recv(), 10))["type"])
        assert "system.metrics" in types and "service.status" in types, types
        print("  ws events:", types)
asyncio.run(main())
PY

echo
echo "ALL SMOKE CHECKS PASSED"
