#!/usr/bin/env bash
#
# Build the ffmpeg Lambda layer for the renderClip/compileClips functions
# (CLIP-002 / BUG-034).
#
# Produces ffmpeg-layer.zip containing:
#   bin/ffmpeg                    — static ffmpeg build (BtbN FFmpeg-Builds,
#                                   linux64-gpl: compiled with libx264 AND
#                                   libfreetype/fontconfig, so the drawtext
#                                   text-overlay filters work — the
#                                   johnvansickle 7.0.2 static build pinned
#                                   previously shipped WITHOUT freetype and
#                                   every text-overlay render failed with
#                                   "No such filter: 'drawtext'")
#   fonts/DejaVuSans-Bold.ttf     — font referenced by every drawtext filter
#
# The script FAILS (exit 1) if the staged binary lacks drawtext or the font
# is missing — a drawtext-less layer must never be publishable again.
#
# Publish as a NEW layer version (see docs/clip-render-infra.md):
#   aws lambda publish-layer-version \
#     --layer-name ffmpeg \
#     --description "BtbN n8.1 linux64-gpl static ffmpeg (drawtext/libx264) + DejaVu Sans Bold" \
#     --zip-file fileb://ffmpeg-layer.zip \
#     --compatible-runtimes nodejs22.x \
#     --region us-west-2
#
set -euo pipefail

ORIG_DIR=$(pwd)
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# BtbN FFmpeg-Builds, n8.1 branch, linux64 GPL variant — the GPL builds are
# configured --enable-libfreetype (drawtext) and --enable-libx264 (the
# encoder the clip template requires). The "latest" release asset is a
# rolling pin to the n8.1 branch; the drawtext assertion below fails the
# build if a future refresh of the asset ever drops freetype.
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz"
FONT_URL="https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip"

echo "==> Downloading static ffmpeg build (BtbN linux64-gpl)..."
curl -fsSL "$FFMPEG_URL" -o "$WORKDIR/ffmpeg.tar.xz"
tar -xJf "$WORKDIR/ffmpeg.tar.xz" -C "$WORKDIR"
# BtbN archives extract to ffmpeg-n<major>.<minor>-latest-linux64-gpl-<ver>/
FFMPEG_DIR=$(find "$WORKDIR" -maxdepth 1 -type d -name 'ffmpeg-*linux64-gpl*' | head -n 1)
test -n "$FFMPEG_DIR" || {
  echo "ffmpeg build directory not found in archive" >&2
  exit 1
}
FFMPEG_BIN="$FFMPEG_DIR/bin/ffmpeg"
test -x "$FFMPEG_BIN" || FFMPEG_BIN="$FFMPEG_DIR/ffmpeg"
test -x "$FFMPEG_BIN" || {
  echo "ffmpeg binary not found in archive" >&2
  exit 1
}

echo "==> Locating DejaVu Sans Bold font..."
mkdir -p "$WORKDIR/stage/bin" "$WORKDIR/stage/fonts"
# find exits 1 when /usr/share/fonts is absent (macOS) — guard it so
# set -euo pipefail doesn't kill the script on the no-system-font path.
SYSTEM_FONT=""
if [ -d /usr/share/fonts ]; then
  SYSTEM_FONT=$(find /usr/share/fonts -name "DejaVuSans-Bold.ttf" 2>/dev/null | head -n 1 || true)
fi
if [ -n "$SYSTEM_FONT" ]; then
  echo "Using system font: $SYSTEM_FONT"
  cp "$SYSTEM_FONT" "$WORKDIR/stage/fonts/DejaVuSans-Bold.ttf"
else
  echo "Fetching DejaVu fonts release tarball..."
  curl -fsSL "$FONT_URL" -o "$WORKDIR/dejavu.zip"
  unzip -j "$WORKDIR/dejavu.zip" "*/ttf/DejaVuSans-Bold.ttf" \
    -d "$WORKDIR/stage/fonts" >/dev/null
fi
test -f "$WORKDIR/stage/fonts/DejaVuSans-Bold.ttf" || {
  echo "DejaVuSans-Bold.ttf not found" >&2
  exit 1
}

cp "$FFMPEG_BIN" "$WORKDIR/stage/bin/ffmpeg"

# ── Shrink to fit the direct-publish cap (same recipe as ffmpeg:3) ──
# PublishLayerVersion's request must stay under ~67MB; the raw BtbN gpl
# binary is ~165MB zipped ~90MB. strip --strip-all + UPX --best gets the
# binary to ~46MB (verified locally 2026-11-02) → zipped ~46–48MB, safely
# under the cap. UPX adds ~1–2s cold-start unpack — fine on a 900s render.
# Both tools are optional so the script still builds an (over-large) layer
# without them; the zip-size assertion below is the hard gate.
if command -v strip >/dev/null 2>&1; then
  echo "==> Stripping symbols..."
  strip --strip-all "$WORKDIR/stage/bin/ffmpeg" 2>/dev/null || true
fi
if command -v upx >/dev/null 2>&1; then
  echo "==> UPX-packing..."
  upx --best --lzma "$WORKDIR/stage/bin/ffmpeg" >/dev/null 2>&1 || {
    echo "  (upx failed — continuing un-packed)" >&2
  }
fi

# ── Build-time assertions (BUG-034): never publish a broken layer again ──

echo "==> Asserting drawtext filter is available..."
"$WORKDIR/stage/bin/ffmpeg" -hide_banner -filters 2>/dev/null \
  | grep -q drawtext || {
    echo "FATAL: staged ffmpeg binary lacks the 'drawtext' filter" >&2
    echo "  (the build was compiled without --enable-libfreetype)" >&2
    echo "  Refusing to build the layer — pick a build with freetype" >&2
    echo "  (BtbN *-linux64-gpl) or clip text overlays will fail with" >&2
    echo "  \"No such filter: 'drawtext'\" like ffmpeg:1 did (BUG-034)." >&2
    exit 1
  }

echo "==> Asserting DejaVuSans-Bold.ttf font is present..."
test -f "$WORKDIR/stage/fonts/DejaVuSans-Bold.ttf" || {
  echo "FATAL: DejaVuSans-Bold.ttf not found in stage/fonts/ —" >&2
  echo "  every drawtext filter references this font (RENDER_FONT_FILE)" >&2
  exit 1
}

echo "==> Assertions passed. Binary:"
"$WORKDIR/stage/bin/ffmpeg" -version | head -n 2
echo "==> drawtext filter line (build evidence):"
"$WORKDIR/stage/bin/ffmpeg" -hide_banner -filters 2>/dev/null | grep drawtext || true

echo "==> Zipping layer..."
(cd "$WORKDIR/stage" && zip -qr "$ORIG_DIR/ffmpeg-layer.zip" bin fonts)
echo "==> Created $ORIG_DIR/ffmpeg-layer.zip"

# Hard gate: the direct PublishLayerVersion API rejects requests over
# 70167211 bytes (RequestEntityTooLargeException, seen 2026-11-02). Refuse
# to hand off an oversized zip — fix the packing above instead.
ZIP_BYTES=$(wc -c < "$ORIG_DIR/ffmpeg-layer.zip" | tr -d ' ')
if [ "$ZIP_BYTES" -ge 70000000 ]; then
  echo "FATAL: ffmpeg-layer.zip is $ZIP_BYTES bytes — over the ~70MB" >&2
  echo "  PublishLayerVersion request cap. Needs more strip/UPX." >&2
  exit 1
fi
echo "==> zip size: $ZIP_BYTES bytes (cap 70000000) — OK"
echo "Next: aws lambda publish-layer-version --layer-name ffmpeg --zip-file fileb://ffmpeg-layer.zip --compatible-runtimes nodejs22.x --region us-west-2"
