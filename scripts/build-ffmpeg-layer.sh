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
SYSTEM_FONT=$(find /usr/share/fonts -name "DejaVuSans-Bold.ttf" 2>/dev/null | head -n 1)
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
echo "Next: aws lambda publish-layer-version --layer-name ffmpeg --zip-file fileb://ffmpeg-layer.zip --compatible-runtimes nodejs22.x --region us-west-2"
