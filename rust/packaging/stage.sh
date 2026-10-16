#!/usr/bin/env bash
# Usage: stage.sh <out-dir> <path-to-executable>
# Copies the executable and the sprite atlas the game needs into <out-dir>.
set -euo pipefail
out="$1"; exe="$2"
root="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$out"; mkdir -p "$out/assets"
cp "$exe" "$out/"
cp -r "$root/assets/atlas" "$out/assets/atlas"
rm -f "$out/assets/atlas/manifest.js"
