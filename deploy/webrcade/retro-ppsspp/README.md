# Experimental PSP application

Players opt in through **Settings → Experimental Settings → Enable PSP
(experimental)**. It is off by default, saved per browser/storage namespace,
and toggling it reloads the library. No Docker enable flag is required.
The library and the PSP app both enforce this preference.

The scanner reads `.iso`, `.cso`, `.pbp` and `.elf` under `psp/roms`, including
subfolders. PSP needs no console BIOS. PPSSPP's redistributable system assets
are included in the app. The PSP controller has separate analog/D-pad inputs,
cross/circle/square/triangle, L/R, Select, Start and Menu.

HTTPS (or localhost), cross-origin isolation, SharedArrayBuffer and WebGL2 are
required. This core is experimental; compatibility and performance vary.
The upstream `celshading.elf` demo currently fails during loading in both this
adapter and EmulatorJS's own frontend. The PBP sprite demo passes the native
browser lifecycle checks; ELF support remains subject to upstream compatibility.
Games larger than 128 MiB use the existing bounded HTTP range reader, retaining
at most 16 MiB of game chunks. Those games require connectivity during play;
partial cached downloads do not make a complete offline game.

In-game `PSP/SAVEDATA` is stored through the native save manager and existing
Nextcloud bridge. Save-state slots follow the native cloud-account settings
and keep a local backup. Per-game identities
remain distinct from the other console apps. Exit saves before stopping the
core, terminating workers, clearing streamed chunks and closing audio.

`build.sh` builds PPSSPP, FFmpeg, RetroArch and the native React wrapper from
pinned sources. It reuses the existing 3DS range reader and Safari save codec.
The PSP build preloads sixteen workers before starting the core, leaving ready
workers for savedata operations. FFmpeg movie decoding uses one thread. This
avoids waiting for new worker initialization while the renderer synchronously
waits for emulation. These settings apply only to the PSP build.
Run from the repository root:

```sh
bash deploy/webrcade/retro-ppsspp/build.sh
```

Requires Docker, Git, Python and rsync. `WORK` selects disposable scratch space;
`OUT` selects the generated `release/psp` directory. `JOBS` controls compilation
parallelism (defaults to four for CI memory limits). Build logs are in `WORK`.
The release contains `app/` and `sources/psp-source.tar.gz`. The latter is served
at `/licenses/sources/psp-source.tar.gz` and includes exact patched sources and
submodules. License notices remain in those sources and `LICENSES/`.

When changing the core, bump `CORE_BASE` in the adapter and its matching build
output directory so previously cached/open games keep matching JS/WASM files.

Validation uses `tests/test_webrcade_psp.cjs` for adapter boundaries,
`tests/browser_webrcade_psp_settings.cjs` for native opt-in behavior, and
`tests/browser_webrcade_psp.cjs` for the compiled core's lifecycle.
`tests/browser_webrcade_psp_launch.cjs` verifies the mobile library's category,
game details and Play flow in Chromium and WebKit, including the canonical
`retro-ppsspp` core registration, centered picture in clipped game frames,
advancing frames through rotation, and pause/resume. The PSP layout fixture
also verifies visual viewport offsets, saved controls and other console layouts.
Both launch tests require `PSP_TEST_ROM`
pointing at an open-source homebrew demo or an
operator-owned game on a disposable instance. The pinned upstream
`pspautotests/demos/sprite.pbp` works as a homebrew fixture. Browser tests
use Playwright, fresh local storage and no cloud account.
