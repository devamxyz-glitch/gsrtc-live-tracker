#!/bin/bash
# Rasterise the app icon SVGs into the PNG set the manifest / iOS / favicons need.
# macOS only (uses QuickLook to render SVG + sips to resample). Re-run after editing icon.svg.
set -euo pipefail
cd "$(dirname "$0")/../web/icons"

render() { # render <src.svg> <out.png>
  rm -f "$1.png"
  qlmanage -t -s 1024 -o . "$1" >/dev/null 2>&1
  mv "$1.png" "$2"
}

render icon.svg _master.png
render icon-maskable.svg _master-maskable.png

for s in 512 384 192 180 152 144 128 96 72 48 32 16; do
  sips -Z $s _master.png --out "icon-$s.png" >/dev/null
done
for s in 512 192; do
  sips -Z $s _master-maskable.png --out "icon-maskable-$s.png" >/dev/null
done

cp icon-180.png apple-touch-icon.png
cp icon-32.png favicon.png
rm -f _master.png _master-maskable.png
echo "icons built:"
ls -1 *.png
