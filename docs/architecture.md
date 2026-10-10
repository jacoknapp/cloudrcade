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
docker build --target web -t cloudrcade:local .
```

Core changes require Docker, Git, Python 3.12+, rsync and ample build space;
the Emscripten and Node images are selected by the core build script. First-time
core builds are substantially slower than ordinary overlay/image updates.
Internal JavaScript and WASM interface names use a generic `Wrcad` namespace.
Storage namespaces and user-facing names are configured through `WEBRCADE_*`
environment variables.

The main image includes Python, chdman and the feed builder. `service.py` supervises Apache, the CORS helper and the scheduled scanner. Scanner failures retain the last complete feed and retry; a web-process failure exits so Docker can restart the app. Scan enablement and interval are runtime environment variables.

The HTTP runtime uses PHP8.3/Apache on Debian Bookworm with Python/chdman for the integrated scanner; it copies tested frontend/core assets from the pinned upstream image.

Feeds are served through an Apache alias from the state mount. No nested feed mount or writable directory inside the operator ROM share is required.
