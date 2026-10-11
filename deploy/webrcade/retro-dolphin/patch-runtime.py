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
    replace('let mounted = false;', 'let mounted = false;\nlet streamedDisc = null;')
    replace('    case "mountFile":\n      return mountFile(payload.file);',
            '    case "mountFile":\n      return mountFile(payload.file);\n'
            '    case "mountUrl":\n      return mountFile({...payload, remote:true});\n'
            '    case "streamStats":\n      return {stream:streamedDisc?.stats() || null};')
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
