"""Adapt the pinned browser host; native patches use a separate source build."""
from pathlib import Path
import re


def patch_runtime(app, native_core_sha=None):
    if native_core_sha is not None:
        if not re.fullmatch(r'[0-9a-f]{64}', native_core_sha):
            raise ValueError('Invalid native core hash')
        protocol = Path(app) / 'vendor/src/upstream-worker-protocol.js'
        original = 'd7395b3a94080f5b7d08a0522f59096007419d117b7b0eb868246429adee6f5c'
        data = protocol.read_text()
        if data.count(original) != 1:
            raise RuntimeError('Unexpected pinned worker protocol core hash')
        protocol.write_text(data.replace(original, native_core_sha))
    worker = Path(app) / 'vendor/src/upstream-discio-worker.js'
    text = worker.read_text()

    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise RuntimeError(f'Unexpected pinned Dolphin worker anchor: {old[:70]}')
        text = text.replace(old,new)

    text = ('import {RemoteDisc} from "../../remote-disc.mjs";\n'
            'import {borrowTextureUpload} from "../../upload-scratch.mjs";\n'
            'import {configureGameCube} from "../../core-config.mjs";\n'
            'import {JitLivenessGuard} from "../../jit-guard.mjs";\n'
            'import {releaseGpuResource} from "../../gpu-resources.mjs";\n'
            'import {destinationAlphaConfig, createDestinationAlphaPipeline, drawDestinationAlpha} from "../../destination-alpha.mjs";\n'
            'import {FrameLimit} from "../../frame-limit.mjs";\n'
            'import {GpuFrameQueue} from "../../gpu-frame-queue.mjs";\n'
            'import {invariantVertexPosition} from "../../shader-position.mjs";\n'
            'import {RenderStats} from "../../render-stats.mjs";\n'
            'import {waitForStateLoad} from "../../state-load.mjs";\n'
            'const gamecubeFrameLimit = new FrameLimit(60);\n'
            'const gamecubeGpuFrames = new GpuFrameQueue({onError:error => markWgpuReplayFatal("gpu-completion", error?.message || error)});\n'
            'const gamecubeRenderStats = new RenderStats();\n'
            'const gamecubeReplayTiming = {totalMs:0,maxMs:0,calls:0};\n'
            'const gamecubeJitGuard = new JitLivenessGuard();\n') + text
    # Queue writes consume a snapshot before returning. Reuse the already
    # bounded immediate-buffer scratch for ordinary texture writes too; held
    # uploads and mapped staging keep their independent lifetime/ownership.
    replace('uploadPayload = heapCopy(src, uploadBytes);',
            'uploadPayload = borrowTextureUpload(heap, src, uploadBytes, copyImmediateWgpuBufferUpload);')
    replace('    wgsl = webGpuTextDecoder.decode(local);',
            '    wgsl = invariantVertexPosition(webGpuTextDecoder.decode(local), stage);')
    replace('  const flushPassDiag = () => {\n    if (passFbId < 0) return;',
            '  const flushPassDiag = () => {\n    if (passFbId < 0) return;\n'
            '    if (wgpuDiagnosticQuiet) {\n'
            '      passFbId = -1;\n'
            '      pd = { pipeOk: 0, pipeMiss: 0, bgOk: 0, bgMiss: 0, draw: 0, drawIdx: 0 };\n'
            '      return;\n'
            '    }')
    replace('  const attrCount = u[25];',
            '  const attrCount = u[25];\n  const destinationAlpha = destinationAlphaConfig(u, webGpuObjects.shaders);')
    replace('desc, target, depthBase, s28dbg, fsId, vsId });',
            'desc, target, depthBase, s28dbg, fsId, vsId, destinationAlpha });')
    replace('    pipe = renderGpu.device.createRenderPipeline(d);',
            '    pipe = createDestinationAlphaPipeline(renderGpu.device, d, tpl.destinationAlpha);')
    replace('            pass.draw(u32[recWord + 1], u32[recWord + 2], u32[recWord + 3], 0);',
            '            drawDestinationAlpha(pass, dtLastPipe, false, u32[recWord + 1], u32[recWord + 2], u32[recWord + 3]);')
    replace('            pass.drawIndexed(u32[recWord + 1], u32[recWord + 2],\n'
            '                             u32[recWord + 3], u32[recWord + 4], 0);',
            '            drawDestinationAlpha(pass, dtLastPipe, true, u32[recWord + 1], u32[recWord + 2], u32[recWord + 3], u32[recWord + 4]);')
    replace('    ...rendererDiagnostics,', '''    ...rendererDiagnostics,
    gpuResources: {
      textures: webGpuObjects.textures.size, buffers: webGpuObjects.buffers.size,
      bindGroups: webGpuObjects.bindGroups.size, pipelines: webGpuObjects.pipeVar.size,
      shaders: webGpuObjects.shaders.size, shaderOk: webGpuObjects.shaderOk,
      shaderFail: webGpuObjects.shaderFail,
    },''')
    replace('    getFrame: cwrap("GetFrame", "number", []),',
            '    getFrame: cwrap("GetFrame", "number", []),\n'
            '    getHeapStats: optionalCwrap("GetHeapStats", "number", []),')
    replace('function framePayload({ forceCausalTelemetry = false } = {}) {',
            'let gamecubeHeapSample=null;\n'
            'function gamecubeHeapStats() {\n'
            '  if (!ppcWasmJitCorePaused) throw new Error("Pause GameCube before inspecting its heap");\n'
            '  const now=performance.now();if (gamecubeHeapSample && now-gamecubeHeapSample.capturedAtMs<1000) return gamecubeHeapSample;\n'
            '  const pointer=api?.getHeapStats?.();if (!pointer) return null;\n'
            '  const values=new Uint32Array(moduleInstance.HEAPU8.buffer,pointer,4);\n'
            '  return gamecubeHeapSample={inUseBytes:values[0],reusableBytes:values[1],extentBytes:values[2],reservedBytes:values[3],capturedAtMs:now,queryMs:performance.now()-now};\n'
            '}\n\nfunction framePayload({ forceCausalTelemetry = false } = {}) {')
    # A complete submitted present is an ordering-safe yield boundary. Leave
    # unread commands in their authoritative ring; never drop GX operations.
    replace('  if (!ring || !renderGpu) return;',
            '  if (!ring || !renderGpu) return;\n'
            '  if (gamecubeGpuFrames.blocked()) return;\n'
            '  if (gamecubeFrameLimit.remaining(performance.now()) > 0) { gamecubeFrameLimit.delayed++; return; }')
    replace('      write === read || wgpuMappedCapacityBlocked ? 4 : 0',
            '      Math.max(gamecubeFrameLimit.timerDelay(performance.now()), write === read || wgpuMappedCapacityBlocked || gamecubeGpuFrames.blocked() ? 4 : 0)')
    replace('          webGpuExecStats.present++;',
            '          webGpuExecStats.present++;\n'
            '          gamecubeGpuFrames.submitted(q);\n'
            '          const gamecubePresentedAt=performance.now();\n'
            '          gamecubeFrameLimit.presented(gamecubePresentedAt);\n'
            '          gamecubeRenderStats.presented(gamecubePresentedAt);')
    replace('    read = (read + 1) >>> 0;\n    if (wgpuReplayBudgetMs > 0) {',
            '    read = (read + 1) >>> 0;\n'
            '    if (webGpuExecStats.present > initialPresentCount) break;\n'
            '    if (wgpuReplayBudgetMs > 0) {')
    replace('  const drainStartedAt = budgetStartedAt || (causalMetricsEnabled ? performance.now() : 0);',
            '  const drainStartedAt = budgetStartedAt || performance.now();')
    replace('function finishWebGpuDrain(startedAt, processed) {',
            'function finishWebGpuDrain(startedAt, processed) {\n'
            '  if (startedAt) { const elapsed=performance.now()-startedAt;\n'
            '    gamecubeReplayTiming.totalMs+=elapsed;gamecubeReplayTiming.maxMs=Math.max(gamecubeReplayTiming.maxMs,elapsed);gamecubeReplayTiming.calls++; }')
    # Physical destroy must follow submission even without mapped coalescing.
    # Bind groups have no destroy API and can leave the map without a submit.
    start = text.index('        case WGPU_CMD_OP_DESTROY: {')
    end = text.index('        case WGPU_CMD_OP_BLIT_TEXTURE: {', start)
    text = text[:start] + '''        case WGPU_CMD_OP_DESTROY: {
          const tag = u32[recWord + 1], id = u32[recWord + 2];
          const released = releaseGpuResource(webGpuObjects, tag, id, {
            metadata: self,
            flush: () => {
              if (pass) {
                markWgpuReplayFatal("destroy-order", "resource destroyed inside a render pass");
                return false;
              }
              if (enc && !submitEnc("destroy")) return false;
              if (pendingWgpuUploadSnapshot().pendingUploads > 0)
                flushMappedUploadsOnly("destroy");
              return !wgpuReplayFatal && pendingWgpuUploadSnapshot().pendingUploads === 0;
            },
            invalidate: (kind, resource) => {
              if (wgpuConsumerStateCacheEnabled)
                wgpuPassStateCache.invalidateDestroyedResource(kind, resource);
            },
          });
          if (!released) markWgpuReplayFatal("destroy-order", "resource work could not be submitted");
          break;
        }
''' + text[end:]
    replace('postStatus(`Experimental WASM ${reason}`);', 'postStatus(`WASM ${reason}`);')
    # A light intro and a heavy world cannot provide a causal JIT comparison.
    # Keep the safety fuse for five seconds without native frame progress.
    start = text.index('function maybeDisablePpcWasmJit(')
    end = text.index('function normalizePpcWasmJitWarmupFrames(', start)
    text = text[:start] + '''function maybeDisablePpcWasmJit(coreFrame = api?.getFrame?.() ?? 0) {
  if (ppcWasmJitCorePaused || ppcWasmJitTimingSuspensions > 0 ||
      !ppcWasmJitActive || ppcWasmJitForce || !api?.setPpcWasmJitEnabled) {
    gamecubeJitGuard.reset();
    return;
  }
  if (!gamecubeJitGuard.stalled(coreFrame, performance.now())) return;
  api.setPpcWasmJitEnabled(0);
  ppcWasmJitActive = false;
  ppcWasmJitDisabledForSession = true;
  postStatus("WASM JIT disabled after five seconds without core frame progress");
}

''' + text[end:]
    replace('function resetPpcWasmJitTiming(invalidateBaseline = false) {',
            'function resetPpcWasmJitTiming(invalidateBaseline = false) {\n  gamecubeJitGuard.reset();\n  gamecubeFrameLimit.reset();\n  gamecubeRenderStats.reset();')
    replace('    frame: api.getFrame(),\n    coreTicks: readCoreTicks(),',
            '    frame: api.getFrame(),\n    capturedAtMs: performance.now(),\n'
            '    heapBytes: moduleInstance.HEAPU8.byteLength,\n'
            '    gamecubeDiagnostics: {fpsLimit:60,gpuQueue:gamecubeGpuFrames.snapshot(),render:gamecubeRenderStats.snapshot(performance.now()),heap:gamecubeHeapSample,replay:{...gamecubeReplayTiming},stream:streamedDisc?.stats() || null,\n'
            '      uploads:{transport:wgpuUploadTransport,stagingBytes:wgpuMappedStagingPool ? wgpuMappedStagingSlotCount*WGPU_MAPPED_STAGING_SLOT_BYTES : 0,scratchBytes:wgpuImmediateBufferScratch.byteLength,pendingRemaps:wgpuMappedRemapPromises.size},\n'
            '      rendererError:rendererDiagnostics.errors.at(-1) || null,\n'
            '      backlog:webGpuCausalStats.backlogAfterLast,jit:jitState,compiled:api.getPpcWasmBlockCompileCount?.() || 0,\n'
            '      resources:{textures:webGpuObjects.textures.size,bindGroups:webGpuObjects.bindGroups.size,shaderOk:webGpuObjects.shaderOk,shaderFail:webGpuObjects.shaderFail},\n'
            '      draws:webGpuExecStats.drawIdx,missingPipelines:webGpuExecStats.missPipe,missingBindings:webGpuExecStats.missBg,skippedDraws:webGpuExecStats.skipDraw},\n'
            '    renderWidth: hardwareVideoBackend ? renderCanvas?.width : width,\n'
            '    renderHeight: hardwareVideoBackend ? renderCanvas?.height : height,\n'
            '    runtimeFailure: wgpuReplayFatal ? `WebGPU ${wgpuReplayFatal.scope}: ${wgpuReplayFatal.detail}` : null,\n'
            '    coreTicks: readCoreTicks(),')
    replace('      recordRendererError("emscripten-abort", reason);',
            '      recordRendererError("emscripten-abort", reason);\n'
            '      self.postMessage({type:"gamecube-fatal",message:`GameCube core aborted: ${reason}`});')
    replace('      postStatus,\n    });\n  });\n\n  return state;',
            '      postStatus: message => { postStatus(message); self.postMessage({type:"gamecube-fatal",message}); },\n'
            '    });\n  });\n\n  return state;')
    replace('    coreBoot.accepted = Boolean(api.bootDisc(path));',
            '    configureGameCube(moduleInstance.FS, api.getGameId());\n'
            '    coreBoot.accepted = Boolean(api.bootDisc(path));')
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
            '    case "heapStats":\n      return {heap:gamecubeHeapStats()};\n'
            '    case "streamStats":\n      return {stream:streamedDisc?.stats() || null};')
    replace('    case "setInputMask":', '''    case "importCards": {
      if (coreBoot.accepted) throw new Error("Load memory cards before boot");
      const fs = moduleInstance.FS;
      let total = 0;
      for (const file of payload.files || []) {
        if (!/^(USA|EUR|JAP)\\/Card A\\/[^/\\\\\\x00-\\x1f]+\\.gci$/.test(file.name)) throw new Error("Invalid memory card path");
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
          if (!/^[^/\\\\\\x00-\\x1f]+\\.gci$/.test(name)) continue;
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
            '  // The device GPU owns this canvas from startup. A queued legacy\n'
            '  // preview must never resize or overwrite its native backbuffer.\n'
            '  cmdRingOwnsCanvas = hardwareVideoBackend;\n'
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
    replace('      const ab = bytes ? bytes.buffer.slice(bytes.byteOffset,\n                                            bytes.byteOffset + bytes.byteLength)\n                       : null;',
            '      const ab = bytes ? bytes.buffer : null;\n'
            '      if (bytes) { try { moduleInstance.FS.unlink(path); } catch {} }')
    replace('        rc = api.loadStateFile(path) | 0;',
            '        const beforeGeneration = api.getLastLoadedCheckpointGeneration() >>> 0;\n'
            '        rc = api.loadStateFile(path) | 0;')
    replace('        await new Promise((r) => setTimeout(r, 1200));',
            '        if (rc === 1) {\n'
            '          try { await waitForStateLoad(() => api.getLastLoadedCheckpointGeneration() >>> 0, beforeGeneration); }\n'
            '          catch (error) { self.postMessage({type:"gamecube-fatal",message:error.message}); throw error; }\n'
            '        }')
    replace('      return { loaded: rc === 1, rc, beforeState, afterState,',
            '      if (!payload.fsPath) { try { moduleInstance.FS.unlink(path); } catch {} }\n'
            '      return { loaded: rc === 1, rc, beforeState, afterState,')
    worker.write_text(text)
