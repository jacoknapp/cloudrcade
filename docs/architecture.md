# Build and upstream maintenance

CloudRcade preserves webRcade's Git history and frontend source. The release
Dockerfile uses its tested 0.2.3 compiled assets by immutable image digest, then builds our
hash-checked library, emulator and controller overlays. This preserves the
compiled core versions against which the patches were tested. Editing the
inherited `src/` directory alone does not change the release image: port those
changes into the overlays or complete a source-build upgrade first.

`deploy/webrcade/` owns the runtime customization. `docker/Dockerfile.upstream`
and the inherited `dist*.sh` scripts document the upstream source build. Their
mutable dependency cloning and old toolchain are not the release pipeline.
Upgrades must update the pinned image, bundle hashes/symbols, core patches,
license/source provenance and regression checks together.

`scripts/prepare-core.py` computes the complete 3DS build-input hash. Matching
inputs reuse a checksum-pinned release package containing the verified key-free
app and its corresponding patched source. Changed inputs rebuild through
`retro-azahar/build.sh` and package the exact patched sources and submodules.
Docker includes those sources at `/licenses/sources/3ds-source.tar.gz`, so they
remain available with every image even if a CI artifact expires. Build outputs
and runtime keys are never committed. To build locally:

```sh
python3 scripts/prepare-core.py
bash deploy/webrcade/retro-ppsspp/build.sh
docker build --target web -t cloudrcade:local .
```

Published images support `linux/amd64` and `linux/arm64`. The pinned upstream
AMD64 image supplies only static browser assets and configuration scripts;
PHP/Apache, Python, Node and chdman come from the target platform's packages.
The overlay generator runs on the builder's native architecture. Browser
JavaScript and WebAssembly run on the player's device on either deployment.

To publish both architectures with a Buildx builder that supports ARM64
(a native ARM builder or QEMU/binfmt installed on the build host):

```sh
python3 scripts/prepare-core.py
docker buildx build --platform linux/amd64,linux/arm64 --target web \
  --tag YOUR_REGISTRY/cloudrcade:YOUR_VERSION --push .
```

CI loads and tests each architecture separately, including actual CHD conversion
and scheduled scanning, before pushing the combined image. For a local ARM64
test, build with `--platform linux/arm64 --load -t cloudrcade:test-arm64` and run
`python3 scripts/smoke-image.py cloudrcade:test-arm64 linux/arm64`. Emulation is
required to run that test on an AMD64 host. These checks verify the server
runtime; physical ARM hardware and game performance require device testing.

Core changes require Docker, Git, Python 3.12+, rsync and ample build space;
the Emscripten and Node images are selected by the core build script. First-time
core builds are substantially slower than ordinary overlay/image updates.

The PSP application is source-built with
`bash deploy/webrcade/retro-ppsspp/build.sh` into `release/psp`. It pins PPSSPP,
FFmpeg (the pinned PPSSPP submodule), RetroArch, wrapper/scaffold, filesystem
dependency and Emscripten. The image includes both its runtime assets and
corresponding source archive. PSP is available by default with no player
or Docker enable flag. The `beta/psp-core` branch publishes
the separate `beta-psp-core` image tag; only master updates `latest`.
Internal JavaScript and WASM interface names use a generic `Wrcad` namespace.
The beta branch includes the experimental
[GameCube core](../deploy/webrcade/retro-dolphin/README.md) through the
`web-gamecube` target and publishes AMD64 only. The main release retains both
server architectures.
Storage namespaces and user-facing names are configured through `WEBRCADE_*`
environment variables.

The main image includes Python, chdman and the feed builder. `service.py` supervises Apache, the CORS helper and the scheduled scanner. Scanner failures retain the last complete feed and retry; a web-process failure exits so Docker can restart the app. Scan enablement and interval are runtime environment variables.

The HTTP runtime uses PHP8.3/Apache on Debian Bookworm with Python/chdman for the integrated scanner; it copies tested frontend/core assets from the pinned upstream image.

Feeds are served through an Apache alias from the state mount. No nested feed mount or writable directory inside the operator ROM share is required.

The mobile library is a small React adapter (`touch/assets/mobile.js` and
`mobile.css`) registered by the pinned bundle hook. It reuses native feed/game
actions, settings and AppScreen, rather than maintaining another save/launcher
implementation. It mounts bounded pages of cards and unmounts its cards/details
and search caches while the app frame runs. Only library HTML loads this adapter;
emulator pages retain their existing controller/core lifecycle. Desktop primary
pointers retain the original carousel. Browser regression:
`tests/browser_webrcade_mobile.cjs` (disposable profile, own ROMs; optional
`WEBRCADE_TEST_3DS_TITLE` also boots and exits an encrypted mounted-key game).

## Reusing unchanged cores in CI

The release workflow maintains separate exact-input caches for the GameCube,
3DS and PSP packages, including their corresponding source distributions.
`scripts/core-cache.py` hashes each core directory, upstream pins, patches,
build/packaging scripts, SDK locks and shared inputs. It verifies a complete
SHA-256 inventory before reusing a package. Missing, changed or corrupt caches
rebuild automatically. Pull requests can restore caches but never save them;
trusted releases save outputs only after image smoke tests and publication.
No operator files, ROMs or build workspaces are cached.

Changes to ordinary library, save bridge or image code reuse all unchanged core
packages. A shared lazy disc reader change invalidates all three packages.
GameCube's HTML embeds controller asset revisions, so those asset changes also
refresh its package. Workflow changes conservatively invalidate all packages,
including changes to runner/Node versions. Build-script toolchain versions and
native locks participate in the keys; mutable remote dependency changes alone
are not polled by the cache. Existing pinned dependencies remain the build inputs.

GameCube also has a separate native-artifact cache. Browser adapter and SDK
changes can regenerate the app and corresponding source without compiling
Dolphin again. Restored native JS/WASM must match the committed artifact locks;
source-tree, patches and recipe checks still run when preparing the package.
3DS and PSP currently cache their complete core/app packages as one unit.

Source/privacy checks, portable regression tests, Docker overlay generation,
image builds and architecture smoke tests still run on every release. The first
run for an input key (or an evicted cache) is a cold build. Choose **Rebuild all
cores from source, bypassing caches** in the manual Docker release workflow to
verify an independent rebuild. Locally, the equivalent is:

```sh
FORCE_CORE_REBUILD=true python3 scripts/core-cache.py prepare gamecube
```

Cache keys are immutable. If a stored cache is damaged, the wrapper rebuilds for
that run; delete that core's cache in Actions to allow a replacement on the next
successful run. Cache eviction never prevents a release build.
