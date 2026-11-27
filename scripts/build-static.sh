#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

output_dir=${1:-dist}
mj_archive=$(mktemp)
trap 'rm -f "$mj_archive"' EXIT

docker compose build web
docker compose run --rm --no-deps -T web sh -ec '
  npm run build >&2
  tar -C dist -cf - .
' > "$mj_archive"

mkdir -p "$output_dir"
tar -xf "$mj_archive" -C "$output_dir"
