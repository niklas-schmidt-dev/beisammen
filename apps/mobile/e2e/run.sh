#!/bin/bash
# Runs a .mob case through the MobAI desktop app's HTTP API (the same path the
# MobAI MCP `test_run` tool uses). The standalone `mobai` CLI (2.7.x) has an
# older parser without repeat/if_exists/wait_stable, so it cannot run these.
#
#   e2e/run.sh <device-id> [case=full-flow.mob] [params-json]
set -euo pipefail
DEVICE="${1:?device id (mobai devices list)}"
CASE="${2:-full-flow.mob}"
PARAMS="${3:-}"; [ -z "$PARAMS"] && PARAMS="{}"
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="${MOBAI_URL:-http://127.0.0.1:8686}"
REQ="$(mktemp)"; OUT="$(mktemp)"
printf '{"device_id":"%s","project_dir":"%s","case_path":"%s","params":%s}' "$DEVICE" "$DIR" "$CASE" "$PARAMS" > "$REQ"
curl -s -m 3600 -X POST -H 'content-type: application/json' --data-binary @"$REQ" "$BASE/api/v1/tests/cases/run" > "$OUT"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(r.passed ? "PASS" : "FAIL", r.error ? "ERROR: " + r.error : "");
for (const s of r.stepResults || []) console.log(` ${s.passed ? "ok " : "XX "} L${s.lineNumber} ${s.durationMs}ms  ${s.lineText}${s.error ? "   <- " + s.error : ""}`);
if (r.extracted) console.log("extracted:", JSON.stringify(r.extracted));
process.exit(r.passed ? 0 : 1);
' "$OUT"
