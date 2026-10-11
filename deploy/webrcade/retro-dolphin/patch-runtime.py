"""Adapt only the pinned browser host; the Dolphin core binaries stay intact."""
from pathlib import Path


def patch_runtime(app):
    worker = Path(app) / 'vendor/src/upstream-discio-worker.js'
    text = worker.read_text()

    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise RuntimeError(f'Unexpected pinned Dolphin worker anchor: {old[:70]}')
        text = text.replace(old,new)

    text = 'import {RemoteDisc} from "../../remote-disc.mjs";\n' + text
    replace('  api.coreInit?.();', '''  moduleInstance.FS.mkdirTree("/dolphin-sys/GC");
  for (const name of ["font_western.bin", "font_japanese.bin"]) {
    const response = await fetch(new URL("../../sys/GC/" + name, import.meta.url));
    if (!response.ok) throw new Error("GameCube system font missing: " + name);
    moduleInstance.FS.writeFile("/dolphin-sys/GC/" + name, new Uint8Array(await response.arrayBuffer()));
  }
  api.coreInit?.();''')
    replace('let mounted = false;', 'let mounted = false;\nlet streamedDisc = null;')
    replace('        if (size > 0) bytes = moduleInstance.FS.readFile(path); // Uint8Array',
            '        if (rc === 1 && stable >= 3 && size > 0 && size <= 256 * 1024 * 1024) bytes = moduleInstance.FS.readFile(path); // Uint8Array')
    replace('    case "mountFile":\n      return mountFile(payload.file);',
            '    case "mountFile":\n      return mountFile(payload.file);\n'
            '    case "mountUrl":\n      return mountFile({...payload, remote:true});\n'
            '    case "streamStats":\n      return {stream:streamedDisc?.stats() || null};')
    replace('    case "setInputMask":', '''    case "importCards": {
      if (coreBoot.accepted) throw new Error("Load memory cards before boot");
      const fs = moduleInstance.FS;
      let total = 0;
      for (const file of payload.files || []) {
        if (!/^(USA|EUR|JAP)\\/Card A\\/[A-Za-z0-9_. -]+\\.gci$/.test(file.name)) throw new Error("Invalid memory card path");
        const bytes = new Uint8Array(file.content);
        total += bytes.length;
        if (total > 64 * 1024 * 1024) throw new Error("Memory card data exceeds 64 MiB");
        const path = "/dolphin-user/GC/" + file.name;
        fs.mkdirTree(path.slice(0, path.lastIndexOf("/")));
        fs.writeFile(path, bytes);
      }
      return {};
    }
    case "exportCards": {
      const fs = moduleInstance.FS, files = [];
      for (const region of ["USA", "EUR", "JAP"]) {
        const folder = region + "/Card A/", path = "/dolphin-user/GC/" + folder;
        let names;
        try { names = fs.readdir(path); } catch { continue; }
        for (const name of names) {
          if (!/^[A-Za-z0-9_. -]+\\.gci$/.test(name)) continue;
          const stat = fs.stat(path + name);
          if (!fs.isFile(stat.mode)) continue;
          files.push({name:folder + name, content:fs.readFile(path + name)});
        }
      }
      return {files};
    }
    case "start":
    case "pause": {
      const paused = type === "pause";
      if (!coreBoot.accepted || !api?.setCorePaused) throw new Error("GameCube is not booted");
      const deadline = performance.now() + 30000;
      while (performance.now() < deadline) {
        api.pumpHostJobs?.();
        api.setCorePaused(paused ? 1 : 0);
        const state = api.getCoreStateName?.();
        if (state === (paused ? "Paused" : "Running")) {
          ppcWasmJitCorePaused = paused;
          resetPpcWasmJitTiming();
          workletAudioProducer.transition();
          return {paused, coreStateName:state, ...framePayload()};
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("GameCube did not reach the requested run state");
    }
    case "setInputMask":''')
    replace('  fs.mount(resolveWorkerFs(moduleInstance), { blobs: [{ name: safeName, data: file }] }, WORKERFS_MOUNT_DIR);\n  mounted = true;',
            '''  streamedDisc?.close();
  streamedDisc = null;
  if (file.remote) {
    streamedDisc = new RemoteDisc(file.url, file.size, file.validator);
    await streamedDisc.reader.ready;
    streamedDisc.node = streamedDisc.mount(fs, path);
  } else {
    fs.mount(resolveWorkerFs(moduleInstance), { blobs: [{ name: safeName, data: file }] }, WORKERFS_MOUNT_DIR);
    mounted = true;
  }''')
    replace('  if (api.bootDisc && file.size >= MIN_FULL_BOOT_BYTES) {',
            '  if (api.bootDisc && file.size >= MIN_FULL_BOOT_BYTES && !file.inspectOnly) {')
    replace('Disc image is too small for full CPU boot (${file.size} bytes)',
            'Disc inspection only or image too small for full CPU boot (${file.size} bytes)')
    # Hardware mode must fail clearly instead of quietly activating a CPU rasterizer.
    replace('  hardwareVideoBackend = videoBackend === "WebGPU-Real";',
            '  hardwareVideoBackend = videoBackend === "WebGPU-Real";\n'
            '  if (hardwareVideoBackend && !canvas && !wgpuDetachedPresenter) {\n'
            '    throw new Error("GameCube hardware rendering requires the transferred browser canvas");\n'
            '  }')
    replace('      const message = error instanceof Error ? error.message : String(error);\n      rendererDiagnostics.fallback',
            '      if (hardwareVideoBackend) throw error;\n      const message = error instanceof Error ? error.message : String(error);\n      rendererDiagnostics.fallback')
    replace('  rendererDiagnostics.adapter = {',
            '''  if (hardwareVideoBackend && (adapterInfo?.isFallbackAdapter || adapter.isFallbackAdapter ||
      /swiftshader|llvmpipe|lavapipe|software/i.test(adapterInfo?.description || ""))) {
    throw new Error("GameCube requires the device GPU; software WebGPU adapters are unsupported");
  }
  rendererDiagnostics.adapter = {''')
    worker.write_text(text)
