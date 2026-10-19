#!/usr/bin/env bash
#
# Build the sharp Lambda layer for the on-media-format function.
#
# Produces sharp-layer.zip containing:
#   nodejs/node_modules/sharp                  — sharp npm package
#   nodejs/node_modules/@img/sharp-*           — linux-x64 N-API binding
#   nodejs/node_modules/@img/sharp-libvips-*    — prebuilt libvips (statically
#                                                linked: libheif, de265, dav1d,
#                                                aom, x265, ...)
#
# libvips >= 8.18.7 (sharp-libvips >= 1.3.4) is REQUIRED for HEIC decode:
# earlier prebuilts (libvips 8.18.6, shipped as layer sharp:5 / sharp 0.35.4)
# bundled libheif WITHOUT the HEVC decoders, so iPhone HEIC report photos
# failed in on-media-format with
#   "heif: Decoder plugin generated an error: Unspecified (7.0)"
# and the upload died as a silent 404 permalink. The script guards for this.
#
# Publish with (see docs/issue-164-infra-setup.md §3):
#   aws lambda publish-layer-version \
#     --layer-name sharp \
#     --zip-file fileb://sharp-layer.zip \
#     --compatible-runtimes nodejs22.x \
#     --region us-west-2
# then bump the layer ARN version in serverless.yml (on-media-format).
#
set -euo pipefail

OUT="${1:-$(pwd)/sharp-layer.zip}"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# Pin: sharp 0.35.5 pairs with sharp-libvips 1.3.4 (libvips 8.18.7). Bump with
# care — the de265 check below is the acceptance gate, not this pin.
SHARP_VERSION="0.35.5"

echo "==> Installing sharp@$SHARP_VERSION (linux-x64 prebuilt)..."
mkdir -p "$WORKDIR/nodejs"
(cd "$WORKDIR/nodejs" &&
  npm install --os=linux --cpu=x64 --libc=glibc --omit=dev \
    "sharp@$SHARP_VERSION" --no-audit --no-fund)

LIBVIPS_SO=$(find "$WORKDIR" -name 'libvips-cpp.so.*' | head -n 1)
test -n "$LIBVIPS_SO" || {
  echo "libvips shared object not found in layer" >&2
  exit 1
}
SHARP_NODE=$(find "$WORKDIR" -name '*.node' -path '*sharp*' | head -n 1)
test -n "$SHARP_NODE" || {
  echo "sharp N-API binding not found in layer" >&2
  exit 1
}

echo "==> Verifying HEIC/HEIF decode support..."
# NOTE: use `grep -c ... >/dev/null`, not `grep -q`: -q closes stdin early,
# strings takes SIGPIPE, and with pipefail the pipeline exits 141 — a
# successful match would read as failure.
file "$SHARP_NODE" | grep -c 'ELF 64-bit.*x86-64' >/dev/null || {
  echo "sharp binding is not linux-x64 ELF: $SHARP_NODE" >&2
  exit 1
}
strings "$LIBVIPS_SO" | grep -ci de265 >/dev/null || {
  echo "libvips prebuilt lacks de265 — HEVC (HEIC) decode would fail" >&2
  echo "need sharp-libvips >= 1.3.4 (libvips 8.18.7)" >&2
  exit 1
}
strings "$LIBVIPS_SO" | grep -ci heifload >/dev/null || {
  echo "libvips prebuilt lacks heifload" >&2
  exit 1
}

echo "==> Zipping layer..."
(cd "$WORKDIR" && zip -qr "$OUT" nodejs)
echo "==> Created $OUT"
unzip -l "$OUT" | tail -n 1
echo "Next: aws lambda publish-layer-version --layer-name sharp --zip-file fileb://$OUT --compatible-runtimes nodejs22.x --region us-west-2"