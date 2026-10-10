# Licenses and source provenance

CloudRcade is independently maintained. Preserve this file, `NOTICE`, the
original `LICENSE` and `LICENSE-third-party` when distributing a derivative.
The Apache license permits a renamed frontend fork; it does not grant the
upstream project's trademarks. Original notices are retained in source files.

| Component | Terms and source |
| --- | --- |
| webRcade frontend and app wrappers | [Apache-2.0](LICENSE), [upstream](https://github.com/webrcade/webrcade); pinned release runtime digest is in `Dockerfile`. |
| CloudRcade standalone deployment/browser additions | Apache-2.0; changes are listed in `NOTICE` and tracked in this fork. |
| Azahar libretro core | [GPL-2.0-or-later](LICENSES/Azahar-GPL-2.0.txt), [EmulatorJS fork](https://github.com/EmulatorJS/azahar/tree/62cfcfb5e488f158f5f7ba83b725bb0ddd04da44); patches and build script are in `deploy/webrcade/retro-azahar`. |
| RetroArch 3DS runtime | [GPL-3.0-or-later](LICENSES/RetroArch-GPL-3.0.txt), [EmulatorJS fork](https://github.com/EmulatorJS/RetroArch/tree/1eb5edf2b3becf0a7b29520a34545628db0c5416); modified corresponding source is included with the image. |
| Nextcloud handoff app | [AGPL-3.0](integrations/nextcloud/LICENSE); complete source is in `integrations/nextcloud/retroarcade_login`. Keep its app ID/namespace stable when upgrading an existing installation. |
| Stock bundled emulator cores | Their individual licenses apply; wrapper Apache licenses do not relicense the cores. Follow each [upstream app repository](https://github.com/webrcade) for core source, notices and build references. |

The stock runtime contains cores with noncommercial terms, including
[FinalBurn Neo](https://github.com/finalburnneo/FBNeo/blob/master/src/license.txt)
and [Snes9x](https://github.com/snes9xgit/snes9x/blob/master/LICENSE).
Do not sell or commercially redistribute the complete core bundle under the
frontend's Apache license. Other cores have copyleft and attribution obligations.
Retained wrapper license texts live under `LICENSES/upstream/`; the wrapper
reference snapshots in `docs/upstream-wrapper-references.json` identify those
texts, rather than claiming current upstream HEAD is the exact source of every
compiled core in the pinned runtime. Upstream source references and licenses
must be reviewed together when changing or redistributing that runtime.

The 3DS build pins Azahar, RetroArch, app-common, scaffold and Emscripten in
`build.sh`. Its release source archive includes the actual patched core source,
submodules, wrapper source and dependency lockfiles used for that build, without
Git history, build outputs, preset-key headers or operator data. The build
scripts and patches in this fork complete the recipe. Exact reused package
checksums and source-input hashes are recorded in `core-release.json`.
Sources are served at `/licenses/sources/3ds-source.tar.gz`; license notices
are under `/licenses/` in the web image.

The upstream slider permission notice remains in `LICENSE-third-party`.
Other JavaScript and system dependencies retain their own package notices and
licenses. No Nintendo keys, BIOS dumps or games are supplied by this project;
the 3DS key-scrambler constant is emulator algorithm code, with preset slots
removed. An operator must provide any runtime BIOS/key material they need.
