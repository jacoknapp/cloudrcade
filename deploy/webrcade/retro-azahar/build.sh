#!/usr/bin/env bash
# Build the Nintendo 3DS webЯcade app (retro-azahar): patched Azahar libretro core linked
# against the EmulatorJS RetroArch port, plus the React app that adapts it to webЯcade.
#
# Requires docker and git. Takes about 15 minutes on 20 cores.
#   WORK  scratch directory (default /tmp/retro-azahar-build, several GB)
#   OUT   output directory  (default ./dist), ready to sync to /opt/webrcade/touch/apps/retro-azahar
#   WEBRCADE_CORE_REVISION optional immutable revision supplied by deploy.py
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-/tmp/retro-azahar-build}
OUT=${OUT:-$HERE/dist}

AZAHAR=62cfcfb5e488f158f5f7ba83b725bb0ddd04da44      # EmulatorJS/azahar
RETROARCH=1eb5edf2b3becf0a7b29520a34545628db0c5416   # EmulatorJS/RetroArch
COMMON=9a7cf19b64a440df8ca9b22a4136b34dc6e9f3db      # webrcade/webrcade-app-common (0.2.3 era)
MELONDS=0df3317838c0b908fac0036ab2e093c531163a46     # webrcade/webrcade-app-retro-melonds (scaffold)
EMSDK=emscripten/emsdk:3.1.74                        # version pinned by EmulatorJS/build

fetch() { # url commit dir
  if [ ! -d "$3/.git" ]; then git init -q "$3"; git -C "$3" remote add origin "$1"; fi
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q -f FETCH_HEAD
}

mkdir -p "$WORK"
# The stock emsdk image has CMake 3.22; Azahar needs 3.25+. 7z packs the linked core.
docker build -q -t retro-azahar-emsdk - <<DOCKER
FROM $EMSDK
RUN pip3 install --no-cache-dir 'cmake>=3.28,<4' && apt-get update -qq && apt-get install -y -qq p7zip-full >/dev/null
DOCKER

fetch https://github.com/EmulatorJS/azahar.git "$AZAHAR" "$WORK/azahar"
git -C "$WORK/azahar" submodule update -q --init --recursive --depth 1 --jobs 8
git -C "$WORK/azahar" clean -q -fd src
git -C "$WORK/azahar" apply "$HERE/patches/azahar-core.patch"
python3 "$HERE/patches/operator-keys.py" "$WORK/azahar"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-mobile.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-performance.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-native-vertex.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-stream.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-formats.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-shadows.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-savestate-stream.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-luts.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-shadow-maps.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-state-result.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-savestate-memory.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-lit-gpu.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-fresh-buffers.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-async-programs.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-remembered-programs.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-cache-stamp.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-wait-for-programs.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-webgl-program-failure.patch"
git -C "$WORK/azahar" apply "$HERE/patches/azahar-runtime-allocations.patch"
fetch https://github.com/EmulatorJS/RetroArch.git "$RETROARCH" "$WORK/RetroArch"
git -C "$WORK/RetroArch" apply "$HERE/patches/retroarch-mobile.patch"
git -C "$WORK/RetroArch" apply "$HERE/patches/retroarch-state-info.patch"
git -C "$WORK/RetroArch" apply "$HERE/patches/retroarch-package.patch"
fetch https://github.com/webrcade/webrcade-app-common.git "$COMMON" "$WORK/webrcade-app-common"
git -C "$WORK/webrcade-app-common" apply "$HERE/patches/app-common-3ds-type.patch"
fetch https://github.com/webrcade/webrcade-app-retro-melonds.git "$MELONDS" "$WORK/webrcade-app-retro-azahar"

run() { docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp "$@"; }

# Core. The CMake cache is bound to the /src mount path; --clean avoids a reconfigure bug.
run -v "$WORK/azahar:/src" -w /src retro-azahar-emsdk bash -c 'emmake ./build-emscripten.sh --clean'
cp "$WORK/azahar/build-emscripten/azahar_libretro_emscripten.a" \
   "$WORK/RetroArch/emulatorjs/azahar_libretro_emscripten.bc"
rm -f "$WORK/EmulatorJS/data/cores/azahar-thread-wasm.data"
run -v "$WORK:/w" -w /w/RetroArch/emulatorjs retro-azahar-emsdk bash -c \
  'emmake ./build-emulatorjs.sh --clean --threads && rm -rf /w/core && mkdir -p /w/core && cd /w/core && 7z x -y ../EmulatorJS/data/cores/azahar-thread-wasm.data >/dev/null'

python3 "$HERE/patches/operator-keys.py" "$WORK/azahar" --verify \
  "$WORK/azahar/build-emscripten/azahar_libretro_emscripten.a" "$WORK/core/azahar_libretro.wasm"

# App: the DS app is only the scaffold (package.json, CRA config); sources come from here.
APP="$WORK/webrcade-app-retro-azahar"
# These directories are disposable build inputs; checkout restores the pinned
# scaffold, and cleaning removes files deleted from our source since last build.
git -C "$APP" clean -q -fdx -- src public
for stale in src/pause src/touchoverlay src/emulator src/App.js src/App.scss public/index.html \
             public/touchtest.html public/touch-gestures.js public/touch-emulator.js public/testanalog.html; do
  rm -rf "${APP:?}/$stale"
done
find "$APP/public/js" -type f -delete
cp -r "$HERE/app/src/." "$APP/src/"
cp -r "$HERE/app/public/." "$APP/public/"
TASK_CORE_REVISION=$(sed -nE "s/^const CORE_REVISION = '([a-zA-Z0-9_-]+)';$/\1/p" "$HERE/app/src/emulator/index.js")
test -n "$TASK_CORE_REVISION"
if [ -n "${WEBRCADE_CORE_REVISION:-}" ]; then
  [[ "$WEBRCADE_CORE_REVISION" =~ ^[a-zA-Z0-9_-]+$ ]]
  TASK_CORE_REVISION=$WEBRCADE_CORE_REVISION
  sed -i "s/^const CORE_REVISION = '[a-zA-Z0-9_-]*';$/const CORE_REVISION = '$TASK_CORE_REVISION';/" "$APP/src/emulator/index.js"
fi
mkdir -p "$APP/public/js/$TASK_CORE_REVISION"
cp "$WORK/core/azahar_libretro.js" "$WORK/core/azahar_libretro.wasm" "$APP/public/js/$TASK_CORE_REVISION/"
sed -i 's#@webrcade/app-retro-melonds#@webrcade/app-retro-azahar#' "$APP/package.json"
run -e CI=false -v "$WORK:/w" -w /w node:16 bash -c \
  'cd webrcade-app-common && npm install --no-audit --no-fund && cd ../webrcade-app-retro-azahar && npm install --no-audit --no-fund && npm run build'

mkdir -p "$OUT"
rsync -a --delete "$APP/build/" "$OUT/"
echo "Built $OUT"
