#!/usr/bin/env bash
# Frame rate and GPU capture on a Quest 3/3S running Repo City in Quest Browser.
# Needs: the headset on USB with developer mode (`npx metavr device list` shows it),
# Repo City open in Quest Browser and inside XR (place the city first).
#   bash tools/headset-perf.sh [label]     -> artifacts/perf-<label>/{fps.txt,*.perfetto-trace,report.md}
set -euo pipefail
label="${1:-$(date +%H%M)}"
out="artifacts/perf-$label"
mkdir -p "$out"
mvr() { npx -y metavr "$@"; }

mvr device list
echo "== 20 s of VrApi frame stats (FPS=present/target, GPU%, CPU/GPU levels)"
( timeout 20 npx -y metavr log -s VrApi 2>/dev/null || true ) | grep -E "FPS=" | tee "$out/fps.txt" | tail -5
awk -F'FPS=' 'NF>1{split($2,a,"/"); n++; s+=a[1]; if(a[1]<min||min=="")min=a[1]} END{if(n) printf "frames sampled: %d lines, mean FPS %.1f, min %d\n", n, s/n, min}' "$out/fps.txt" | tee "$out/summary.txt"

echo "== 10 s GPU trace of Quest Browser"
mvr perf capture --mode gpu --duration 10000 --app com.oculus.browser --gpu-counters low -o "$out/repo-city-$label"
mvr perf analyze-trace --app com.oculus.browser --report-out "$out/report.md" --json-out "$out/report.json" || true
echo "done -> $out (compare two runs: npx metavr perf traces; npx metavr perf compare <old> <new>)"
