#!/usr/bin/env bash
#
# Build the ffmpeg Lambda layer for the renderClip function (CLIP-002).
#
# Produces ffmpeg-layer.zip containing:
#   bin/ffmpeg                    — static ffmpeg build (johnvansickle.com,
#                                   includes libfreetype/fontconfig for
#                                   drawtext text overlays)
#   fonts/DejaVuSans-Bold.ttf     — font referenced by every drawtext filter
#
# Publish with (see docs/clip-render-infra.md):
#   aws lambda publish-layer-version \
#     --layer-name ffmpeg \
#     --zip-file fileb://ffmpeg-layer.zip \
#     --compatible-runtimes nodejs22.x \
#     --region us-west-2
#
set -euo pipefail

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
FONT_URL="https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip"

echo "==> Downloading static ffmpeg build..."
curl -fsSL "$FFMPEG_URL" -o "$WORKDIR/ffmpeg.tar.xz"
tar -xJf "$WORKDIR/ffmpeg.tar.xz" -C "$WORKDIR"
FFMPEG_DIR=$(find "$WORKDIR" -maxdepth 1 -type d -name 'ffmpeg-*static' | head -n 1)
test -x "$FFMPEG_DIR/ffmpeg" || {
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

cp "$FFMPEG_DIR/ffmpeg" "$WORKDIR/stage/bin/ffmpeg"

"$WORKDIR/stage/bin/ffmpeg" -version | head -n 2

echo "==> Zipping layer..."
(cd "$WORKDIR/stage" && zip -qr "$OLDPWD/ffmpeg-layer.zip" bin fonts)
echo "==> Created $(pwd)/ffmpeg-layer.zip"
echo "Next: aws lambda publish-layer-version --layer-name ffmpeg --zip-file fileb://ffmpeg-layer.zip --compatible-runtimes nodejs22.x --region us-west-2"