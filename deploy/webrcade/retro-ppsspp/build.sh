#!/usr/bin/env bash
# Build a pinned PSP app and its corresponding source package.
# Requires Docker, Git, Python, rsync and network access. No ROMs or BIOS needed.
# WORK is disposable scratch space; OUT is the generated release/psp directory.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-/tmp/cloudrcade-psp-build}
OUT=${OUT:-$HERE/../../../release/psp}
JOBS=${JOBS:-4}
PPSSPP=fa917ebd212e083912d742c830eecb242b6a98ae
RETROARCH=1eb5edf2b3becf0a7b29520a34545628db0c5416
COMMON=9a7cf19b64a440df8ca9b22a4136b34dc6e9f3db
SCAFFOLD=0df3317838c0b908fac0036ab2e093c531163a46
FILESYSTEM=3812f8a6f31ed67d32272ac33fe2b85c6b2c947e
EMSDK=emscripten/emsdk:3.1.74
fetch() {
  if [ ! -d "$3/.git" ]; then git init -q "$3"; git -C "$3" remote add origin "$1"; fi
  git -C "$3" fetch -q --depth 1 origin "$2"
  git -C "$3" checkout -q -f FETCH_HEAD
}
run() { docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp "$@"; }
mkdir -p "$WORK"
fetch https://github.com/EmulatorJS/ppsspp.git "$PPSSPP" "$WORK/ppsspp"
git -C "$WORK/ppsspp" submodule update -q --init --recursive --depth 1 --jobs 8
# Upstream's wasm recipe replaces armips' older filesystem dependency. Pin it.
fetch https://github.com/gulrak/filesystem.git "$FILESYSTEM" "$WORK/filesystem"
rsync -a --delete --exclude .git "$WORK/filesystem/" "$WORK/ppsspp/ext/armips/ext/filesystem/"
fetch https://github.com/EmulatorJS/RetroArch.git "$RETROARCH" "$WORK/RetroArch"
fetch https://github.com/webrcade/webrcade-app-common.git "$COMMON" "$WORK/webrcade-app-common"
fetch https://github.com/webrcade/webrcade-app-retro-melonds.git "$SCAFFOLD" "$WORK/webrcade-app-retro-ppsspp"
python3 "$HERE/patch-build.py" "$WORK"

# Keep FFmpeg enabled: PSP videos and ATRAC audio require these libraries.
TASK_FFMPEG_STAMP="$(git -C "$WORK/ppsspp/ffmpeg" rev-parse HEAD):$(sha256sum "$WORK/ppsspp/libretro/emscripten/linux_wasm32.sh" | cut -d' ' -f1):$EMSDK"
TASK_FFMPEG_COMPLETE=true
for library in avcodec avformat avutil swresample swscale; do
  [ -s "$WORK/ppsspp/ffmpeg/linux/wasm32/lib/lib$library.a" ] || TASK_FFMPEG_COMPLETE=false
done
if [ "$TASK_FFMPEG_COMPLETE" != true ] || [ "$(cat "$WORK/ffmpeg-build.stamp" 2>/dev/null || true)" != "$TASK_FFMPEG_STAMP" ]; then
  run -v "$WORK/ppsspp:/src" -w /src/ffmpeg "$EMSDK" bash -c \
    'bash ../libretro/emscripten/linux_wasm32.sh' > "$WORK/ffmpeg-build.log" 2>&1
  printf '%s\n' "$TASK_FFMPEG_STAMP" > "$WORK/ffmpeg-build.stamp"
fi
run -e JOBS="$JOBS" -v "$WORK/ppsspp:/src" -w /src/libretro "$EMSDK" bash -c \
  'emmake make platform=emscripten -j"$JOBS"' > "$WORK/ppsspp-build.log" 2>&1
mkdir -p "$WORK/RetroArch/ffmpeg"
cp "$WORK/ppsspp/ffmpeg/linux/wasm32/lib/"*.a "$WORK/RetroArch/ffmpeg/"
cp "$WORK/ppsspp/libretro/ppsspp_libretro_emscripten.bc" "$WORK/RetroArch/libretro_emscripten.bc"
# Leave ready workers for transient savedata operations as well as the core's
# permanent threads. Starting a new browser worker while the renderer waits
# for the emulation thread can deadlock the save dialog's synchronous join.
run -e JOBS="$JOBS" -v "$WORK/RetroArch:/src" -w /src "$EMSDK" bash -c \
  'emmake make -f Makefile.emulatorjs HAVE_7ZIP=1 HAVE_CHD=1 HAVE_THREADS=1 PTHREAD_POOL_SIZE=16 ASYNC=1 HAVE_OPENGLES3=1 STACK_SIZE=8388608 INITIAL_HEAP=268435456 HAVE_AL=0 HAVE_RWEBAUDIO=1 TARGET=ppsspp_libretro.js -j"$JOBS"' \
  > "$WORK/retroarch-build.log" 2>&1

APP="$WORK/webrcade-app-retro-ppsspp"
git -C "$APP" clean -q -fdx -- src public
rm -rf "${APP:?}/src" "${APP:?}/public"
cp -r "$HERE/app/src" "$HERE/app/public" "$APP/"
# Share the existing, tested bounded HTTP range reader without another copy.
cp "$HERE/../retro-azahar/app/src/emulator/lazyrom.js" "$APP/src/emulator/"
mkdir -p "$APP/public/js/v3" "$APP/public/assets"
cp "$WORK/RetroArch/ppsspp_libretro.js" "$WORK/RetroArch/ppsspp_libretro.wasm" "$APP/public/js/v3/"
python3 "$HERE/package-assets.py" "$WORK/ppsspp/assets" "$APP/public/assets"
sed -i 's#@webrcade/app-retro-melonds#@webrcade/app-retro-ppsspp#' "$APP/package.json"
run -e CI=false -v "$WORK:/w" -w /w node:16 bash -c \
  'cd webrcade-app-common && npm install --no-audit --no-fund && cd ../webrcade-app-retro-ppsspp && npm install --no-audit --no-fund && npm run build' \
  > "$WORK/app-build.log" 2>&1
mkdir -p "$OUT/app" "$OUT/sources"
rsync -a --delete "$APP/build/" "$OUT/app/"
python3 "$HERE/package-source.py" "$WORK" "$OUT/sources/psp-source.tar.gz"
echo "Built PSP app: $OUT"
