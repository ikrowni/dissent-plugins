#!/usr/bin/env bash
# Builds nfl-hub's server module: bundle → compile → report what the manifest needs.
#
# ⚠️ THIS SCRIPT CANNOT SIGN. The signing private key is deliberately not on the
# node — a key on the VPS would let anyone with VPS access sign code the node
# then trusts and executes. This prints the sha256 and size; the OWNER produces
# the signature on their own machine.
#
# ⚠️ THE ARTIFACT IS CONTENT-ADDRESSED: module-<first 12 of sha256>.wasm. There
# is deliberately no fixed `module.wasm`, because a fixed name means one file
# whose meaning depends on WHEN you look at it — and that cost two wasted
# signatures on 2026-08-10. The owner signed a stale binary, twice, because the
# tree held the last PUBLISHED build under the name a new build would also take.
#
# A new build simply cannot overwrite a published one now: different bytes,
# different name. Both can sit side by side while the manifest keeps vouching
# for the old one, so client-side work never queues behind a signature.
#
# ⚠️ RENAMING IS SAFE. The signature covers the plugin id and the DIGEST, never
# the URL (internal/pluginmodule/signature.go: sigContext + pluginID + "\n" +
# digestHex). Moving an artifact and repointing manifest.server_module.url does
# not invalidate anything.
#
# ⚠️ The SDK is NOT vendored into this repo. It is copied from dissent-core at
# build time, because that copy is canonical and lives beside the Go host
# functions it wraps so the two cannot drift. A vendored copy would drift.
set -euo pipefail
cd "$(dirname "$0")"

DISSENT_CORE="${DISSENT_CORE:-$HOME/projects/dissent-core}"
SDK="$DISSENT_CORE/internal/pluginruntime/sdk/server-sdk.js"
if [ ! -f "$SDK" ]; then
  echo "build: cannot find the canonical server SDK at $SDK" >&2
  echo "       set DISSENT_CORE to your dissent-core checkout" >&2
  exit 1
fi

EXTISM_JS_VERSION="v1.6.0"
BINARYEN_VERSION="version_131"
case "$(uname -m)" in
  aarch64|arm64) ARCH="aarch64" ;;
  x86_64)        ARCH="x86_64" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

TOOLS="$(mktemp -d)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$TOOLS" "$BUILD"' EXIT

# ⚠️ binaryen's wasm-merge must be on PATH for extism-js, and the v1.6.0 release
# binary self-reports "1.5.1" — pin by URL, never by --version.
if ! command -v wasm-merge >/dev/null 2>&1; then
  echo "fetching binaryen ${BINARYEN_VERSION}…"
  curl -sSfL -o "$TOOLS/binaryen.tar.gz" \
    "https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/binaryen-${BINARYEN_VERSION}-${ARCH}-linux.tar.gz"
  tar xzf "$TOOLS/binaryen.tar.gz" -C "$TOOLS"
  export PATH="$TOOLS/binaryen-${BINARYEN_VERSION}/bin:$PATH"
fi

if command -v extism-js >/dev/null 2>&1; then
  EJS=extism-js
else
  echo "fetching extism-js ${EXTISM_JS_VERSION}…"
  curl -sSfL -o "$TOOLS/ejs.gz" \
    "https://github.com/extism/js-pdk/releases/download/${EXTISM_JS_VERSION}/extism-js-${ARCH}-linux-${EXTISM_JS_VERSION}.gz"
  gunzip -f "$TOOLS/ejs.gz"
  chmod +x "$TOOLS/ejs"
  EJS="$TOOLS/ejs"
fi

# Stage sources preserving the REAL directory shape: server/ beside core/.
#
# ⚠️ THE LAYOUT MATTERS. ops-*.js import "../core/league/*.js", so flattening
# main.js into the build root would put those imports outside it and esbuild
# would fail — or worse, resolve something unexpected. Staging server/ and core/
# as siblings makes every relative path mean what it means in the repo.
#
# The SDK is copied from dissent-core rather than vendored, because that copy is
# canonical and lives beside the Go host functions it wraps so the two cannot
# drift.
mkdir -p "$BUILD/server/sdk" "$BUILD/core"
cp "$SDK" "$BUILD/server/sdk/server-sdk.js"
cp ./*.js "$BUILD/server/"
cp -r ../core/league "$BUILD/core/league"

# ⚠️ THE VERSION IS GENERATED, never hand-maintained. It was a constant in
# main.js and it lagged whenever a bump was forgotten, so `ping` reported a build
# that was not the one running. Taking it from the manifest means the number the
# module reports is by construction the number that was published.
VERSION=$(node -p "require('$PWD/../manifest.json').version")
printf 'export const MODULE_VERSION = "%s";\n' "$VERSION" > "$BUILD/server/version.js"
echo "module version: $VERSION (from manifest.json)"

# ⚠️ BUNDLE FIRST. extism-js does not resolve imports; feeding it a file with an
# `import` fails at build time with an unhelpful message.
npx --yes esbuild "$BUILD/server/main.js" --bundle --format=cjs --platform=neutral \
  --outfile="$BUILD/bundled.js" >/dev/null

# Built to a temporary name first: the final one is derived from the digest,
# which does not exist until the bytes do.
"$EJS" "$BUILD/bundled.js" -i module.d.ts -o "$BUILD/out.wasm"

SIZE=$(stat -c%s "$BUILD/out.wasm")
SHA=$(sha256sum "$BUILD/out.wasm" | cut -d' ' -f1)
NAME="module-${SHA:0:12}.wasm"
cp "$BUILD/out.wasm" "$NAME"

echo
echo "built $NAME"
echo "  size:   $SIZE"
echo "  sha256: $SHA"
echo
# ⚠️ Every artifact ever built stays until it is deliberately removed. Deleting
# the previous one here would break the CURRENTLY PUBLISHED plugin the moment
# this ran, since the manifest still points at it.
OTHERS=$(ls module-*.wasm 2>/dev/null | grep -v "^$NAME$" || true)
if [ -n "$OTHERS" ]; then
  echo "other artifacts present (delete only after the manifest has moved off them):"
  for f in $OTHERS; do echo "  $f"; done
  echo
fi

cat <<NEXTSTEPS

NEXT — on the OWNER's machine, not here:
  git pull
  node plugin-module-key.mjs sign nfl-hub $NAME plugin-module-key.pem

then, back here, put this in manifest.json's server_module block:
  "url":       "https://plugins.dissent.chat/plugins/nfl-hub/server/$NAME"
  "sha256":    "$SHA"
  "size":      $SIZE
  "signature": "<from the signing tool>"
NEXTSTEPS
