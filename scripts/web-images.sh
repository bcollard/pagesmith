#!/usr/bin/env bash
# Builds the WebP copies the website shows inline (640 and 1280 px wide) from
# the full-size JPEG screenshots in docs/img/screenshots/. The JPEGs stay as
# the click-to-zoom originals. Run after `npm run screenshots`.
# Needs ImageMagick (magick) and cwebp.
set -euo pipefail
cd "$(dirname "$0")/../docs/img/screenshots"
for jpg in [0-9]-*.jpg; do
  base="${jpg%.jpg}"
  for w in 640 1280; do
    magick "$jpg" -resize "${w}x" -strip ppm:- | cwebp -quiet -q 80 -o "${base}-${w}.webp" -- -
  done
  echo "wrote ${base}-640.webp ${base}-1280.webp"
done
