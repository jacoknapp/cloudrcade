"""Dedicated GX decode opcode; applied after ordinary pinned-host adaptation."""

def patch_texture_decode(text):
    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise RuntimeError(f'Unexpected texture decode anchor: {old[:100]} ({text.count(old)})')
        text = text.replace(old, new)

    text = ('import {encodeTextureDecode, TEXTURE_DECODE_OP} from "../../texture-decode.mjs";\n'
            'let gamecubeTextureDecodeEnabled = true;\n'
            'const gamecubeTextureDecodeStats = {count:0, sourceBytes:0, decodedBytes:0, encodeMs:0, byFormat:{}};\n') + text
    replace('      causalMetricsEnabled = Boolean(payload.collectMetrics);',
            '      gamecubeTextureDecodeEnabled = payload.wgpuTextureDecode !== false;\n'
            '      causalMetricsEnabled = Boolean(payload.collectMetrics);')
    # Existing feature-mask call is the protocol capability handshake. Old consumers
    # never set bit 1, and native defaults omit it, preserving their CPU fallback.
    replace('  let rendererFeatureMask = RENDERER_FEATURE_SCISSORED_CLEAR_RECT;',
            '  let rendererFeatureMask = RENDERER_FEATURE_SCISSORED_CLEAR_RECT | (gamecubeTextureDecodeEnabled ? 2 : 0);')
    replace('    gpuResources: {',
            '    textureDecode: {...gamecubeTextureDecodeStats, enabled:gamecubeTextureDecodeEnabled},\n    gpuResources: {')
    replace('    } else if (op === WGPU_CMD_OP_UPLOAD_TEXTURE) {\n      pointer = u32[word + 2];',
            '    } else if (op === TEXTURE_DECODE_OP) {\n'
            '      pointer = u32[word + 2];\n      bytes = u32[word + 3];\n      kind = "gx-decode";\n'
            '    } else if (op === WGPU_CMD_OP_UPLOAD_TEXTURE) {\n      pointer = u32[word + 2];')
    replace('      } else if (op === WGPU_CMD_OP_UPLOAD_TEXTURE) {\n        releaseWgpuUploadPayload(',
            '      } else if (op === TEXTURE_DECODE_OP) {\n'
            '        releaseWgpuUploadPayload(ring, fenceU32[word + 2], fenceU32[word + 3]);\n'
            '      } else if (op === WGPU_CMD_OP_UPLOAD_TEXTURE) {\n        releaseWgpuUploadPayload(')
    replace('  let lastSubmitFailureReason = null;',
            '  const gamecubeDecodeBuffers = [];\n  let gamecubeDecodeBufferBytes = 0;\n'
            '  let lastSubmitFailureReason = null;')
    replace('      gpuCompletionTracker.recordSubmittedWork(q, "hardware-replay");',
            '      for (const buffer of gamecubeDecodeBuffers.splice(0)) buffer.destroy();\n'
            '      gamecubeDecodeBufferBytes = 0;\n'
            '      gpuCompletionTracker.recordSubmittedWork(q, "hardware-replay");')
    replace('      lastSubmitFailureReason = "submit-error";\n      rejectMappedBatch(mappedBatch, e);',
            '      for (const buffer of gamecubeDecodeBuffers.splice(0)) buffer.destroy();\n'
            '      gamecubeDecodeBufferBytes = 0;\n'
            '      lastSubmitFailureReason = "submit-error";\n      rejectMappedBatch(mappedBatch, e);')
    replace('        case WGPU_CMD_OP_UPLOAD_TEXTURE: {', '''        case TEXTURE_DECODE_OP: {
          // Producer closes/commits its old pass before this write, including pooled
          // texture reuse. Never interrupt and silently lose a live pass's state.
          if (pass) throw new Error("GX decode inside render pass");
          const source = u32[recWord + 2], bytes = u32[recWord + 3];
          const staged = ring.stagedUploads?.get(read);
          const texture = webGpuObjects.textures.get(u32[recWord + 1]);
          // Bound immutable uploads held by one encoder. Submission order preserves
          // preceding draws, decodes, copies and subsequent texture reads.
          if (gamecubeDecodeBufferBytes + bytes + 16 > 8 * 1024 * 1024 ||
              gamecubeDecodeBuffers.length >= 256) {
            submitEnc("gx-decode-capacity");
            if (wgpuReplayFatal) break;
          }
          ensureEnc();
          const started = causalMetricsEnabled ? performance.now() : 0;
          const decoded = encodeTextureDecode(dev, enc, texture,
            staged?.data ?? new Uint8Array(moduleInstance.HEAPU8.buffer, source, bytes),
            u32[recWord + 4], u32[recWord + 5], u32[recWord + 7], u32[recWord + 6]);
          gamecubeDecodeBuffers.push(...decoded.buffers);
          gamecubeDecodeBufferBytes += decoded.bytes;
          if (staged) {
            ring.stagedUploads.delete(read);
            ring.stagedUploadBytes = Math.max(0, ring.stagedUploadBytes - staged.data.byteLength);
          } else {
            releaseWgpuUploadPayload(ring, source, bytes);
          }
          gamecubeTextureDecodeStats.count++;
          gamecubeTextureDecodeStats.sourceBytes += decoded.dataBytes + decoded.paletteBytes;
          gamecubeTextureDecodeStats.decodedBytes += u32[recWord + 4] * u32[recWord + 5] * 4;
          if (started) gamecubeTextureDecodeStats.encodeMs += performance.now() - started;
          const format = decoded.format;
          gamecubeTextureDecodeStats.byFormat[format] = (gamecubeTextureDecodeStats.byFormat[format] || 0) + 1;
          break;
        }
        case WGPU_CMD_OP_UPLOAD_TEXTURE: {
          // Queue writes execute before not-yet-submitted command buffers. A CPU
          // fallback/pool reuse after a decode must not be reordered ahead of it.
          if (gamecubeDecodeBuffers.length) {
            if (pass) {
              markWgpuReplayFatal("texture-decode-order", "GX fallback upload inside render pass");
              break;
            }
            submitEnc("gx-decode-before-upload");
            if (wgpuReplayFatal) break;
          }''')
    replace('      replayRecordAccepted = false;\n      webGpuCausalStats.errorCount += 1;',
            '      replayRecordAccepted = false;\n'
            '      if (op === TEXTURE_DECODE_OP) markWgpuReplayFatal("texture-decode", e?.message || e);\n'
            '      webGpuCausalStats.errorCount += 1;')
    # A terminal consumer failure abandons any remaining encoder resources. Ordinary
    # drains submit first, leaving this list empty. No promise can outlive the owner.
    replace('    enc = null;\n    if (errScope) {',
            '    for (const buffer of gamecubeDecodeBuffers.splice(0)) buffer.destroy();\n'
            '    gamecubeDecodeBufferBytes = 0;\n    enc = null;\n    if (errScope) {')
    replace('  const stopReason = deferBeginPass',
            '  if (wgpuReplayFatal) {\n'
            '    for (const buffer of gamecubeDecodeBuffers.splice(0)) buffer.destroy();\n'
            '    gamecubeDecodeBufferBytes = 0;\n  }\n'
            '  const stopReason = deferBeginPass')
    return text
