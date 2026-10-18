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
python3 scripts/core-cache.py prepare 3ds
python3 scripts/core-cache.py prepare psp
python3 scripts/core-cache.py prepare gamecube
# Required by the Dockerfile:
python3 scripts/core-cache.py prepare ps2
docker build --target web -t cloudrcade:local .
```

Main and release-tag images support `linux/amd64` and `linux/arm64`; beta branch
images publish only `linux/amd64`. The pinned upstream
AMD64 image supplies only static browser assets and configuration scripts;
PHP/Apache, Python, Node and chdman come from the target platform's packages.
The overlay generator runs on the builder's native architecture. Browser
JavaScript and WebAssembly run on the player's device on either deployment.

To publish both architectures with a Buildx builder that supports ARM64
(a native ARM builder or QEMU/binfmt installed on the build host):

```sh
docker buildx build --platform linux/amd64,linux/arm64 --target web \
  --tag YOUR_REGISTRY/cloudrcade:YOUR_VERSION --push .
```

Prepare all core packages as above before this command. CI loads and tests each
enabled architecture separately, including actual CHD conversion
and scheduled scanning, before pushing the combined image. For a local ARM64
test, build with `--platform linux/arm64 --load -t cloudrcade:test-arm64` and run
`python3 scripts/smoke-image.py cloudrcade:test-arm64 linux/arm64 --gamecube`. Emulation is
required to run that test on an AMD64 host. These checks verify the server
runtime; physical ARM hardware and game performance require device testing.

Core changes require Docker, Git, Python 3.12+, Node.js 22+, npm, rsync and ample build space;
the Emscripten and Node images are selected by the core build script. First-time
core builds are substantially slower than ordinary overlay/image updates.

The PSP application is source-built with
`bash deploy/webrcade/retro-ppsspp/build.sh` into `release/psp`. It pins PPSSPP,
FFmpeg (the pinned PPSSPP submodule), RetroArch, wrapper/scaffold, filesystem
dependency and Emscripten. The image includes both its runtime assets and
corresponding source archive. PSP is available by default with no player
or Docker enable flag. The standard `web` release includes the
[GameCube core](../deploy/webrcade/retro-dolphin/README.md), enabled by default
with no experimental opt-in. `main` publishes `latest` for AMD64 and ARM64;
GameCube renders in the client browser using WebGPU on its device GPU. The
historical `/experimental/gamecube/` launch URL remains compatible with existing
links. The standard image also includes the
[PlayStation 2 core](../deploy/webrcade/retro-play/README.md), available by default
with no enable setting. Its optional performance readout lives in Core Settings.
The historical `/experimental/ps2/` launch URL remains compatible. The
`beta/ps2-core` candidate branch publishes `beta-ps2-core` for AMD64 only;
main publishes the standard cores for both AMD64 and ARM64.
Storage namespaces and user-facing names are configured through `WEBRCADE_*`
environment variables.

The main image includes Python, chdman and the feed builder. `service.py` supervises Apache, PHP-FPM, the CORS helper and the scheduled scanner. Scanner failures retain the last complete feed and retry; a web-process failure exits so Docker can restart the app. Scan enablement and interval are runtime environment variables.

The HTTP runtime uses Apache event MPM with HTTP/2 over TLS and PHP 8.3-FPM on Debian Bookworm, with Python/chdman for the integrated scanner. PHP uses a container-local FastCGI listener on `127.0.0.1:9000`; it inherits runtime environment variables and keeps PHP sessions and API request guards. Static assets and ROM ranges can share an HTTP/2 connection with PHP API requests. HTTP/1.1 remains available for existing reverse proxies. The image copies tested frontend/core assets from the pinned upstream image.

Compose supplies two mounts: writable `/config` for state, TLS and optional metadata credentials, and read-only `/roms` for games, managed files and BIOS/keys. Startup maps those mounts to the server paths used by existing overlays. Feeds are served through an Apache alias from `/config/data/feeds`; converted discs live under `/config/data/derived`. No nested feed mount or writable directory inside the operator ROM share is required.

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
3DS, PSP and PlayStation 2 packages, including their corresponding
source distributions.
`scripts/core-cache.py` hashes each core directory, upstream pins, patches,
build/packaging scripts, SDK locks and shared inputs. It verifies a complete
SHA-256 inventory before reusing a package. Missing, changed or corrupt caches
rebuild automatically. Pull requests can restore caches but never save them;
trusted releases save outputs only after image smoke tests and publication.
No operator files, ROMs or build workspaces are cached.

Changes to ordinary library, save bridge or image code reuse all unchanged core
packages. A shared lazy disc reader change invalidates GameCube, 3DS and PSP
packages. GameCube and PS2 package keys also cover their shared save SDK and
controller assets, so those changes refresh the affected packages. Keys cover
each core's compiler command, effective build environment, and toolchain inputs.
Host runner changes refresh full packages; the Node setup version affects the
GameCube and PS2 packages that use it. 3DS and PSP use their Docker recipes'
Node versions. Cache actions, step labels, release scheduling, generic cache
helpers and unused operator guides do not trigger core builds. Put compiler
options in tracked recipes or global/job/preparation-step environment variables;
the workflow fingerprint reads the build job's ordinary block-form steps.
Mutable remote dependencies are not polled; tracked pins remain the build inputs.

GameCube and PS2 also have separate native-artifact caches. Browser adapter and
SDK changes can regenerate the app and corresponding source without compiling
Dolphin, Play or the PS2 WebGPU worker again. Restored native JS/WASM must match
the committed artifact locks; current native source, patch and recipe checks
still run when preparing the package. PS2 additionally requires its native input
hash to match the committed lock. 3DS and PSP cache complete packages as one unit.

Source/privacy checks, portable regression tests, Docker overlay generation,
image builds and architecture smoke tests still run on every release. Changed
inputs compile when no matching verified artifacts are available. Choose **Rebuild all
cores from source, bypassing caches** in the manual Docker release workflow to
verify an independent rebuild. Locally, the equivalent is:

```sh
FORCE_CORE_REBUILD=true python3 scripts/core-cache.py prepare gamecube
```

Cache keys are immutable. If a stored cache is damaged, the wrapper rebuilds for
that run; delete that core's cache in Actions to allow a replacement on the next
successful run. Cache eviction never prevents a release build.

When Actions caches are missing or invalid, the workflow can restore unchanged
packages from the branch's last successful published CI release. It requires an
ancestor commit, exact repository/revision provenance, and an immutable OCI
digest; a pinned qualified release provides a fallback. Every effective input
must match that source commit before extraction and sealing. Native-only caches
can also be recovered when just the wrapper changed. Current native locks,
complete inventories, source checks and image checks still apply. Changed inputs
compile normally; forced source rebuilds bypass all restore paths.
