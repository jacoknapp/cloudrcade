"""Drop final backbuffer passes, preserving every offscreen command and submit.

Runs after the shared runtime patch. No native rebuild or save format change.
"""
def patch_frame_skip(text):
    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise RuntimeError('Unexpected frame-skip anchor: ' + old[:90])
        text = text.replace(old, new)

    text = 'import {FrameSkip} from "../../frame-skip.mjs";\nconst gamecubeFrameSkip = new FrameSkip();\nlet gamecubeSkipDisplayPass = false;\n' + text
    replace('    case "nativeTiming": {', '''    case "frameSkip":
      return {divisor:gamecubeFrameSkip.set(payload.divisor)};
    case "nativeTiming": {''')
    replace('gamecubeDiagnostics: {fpsLimit:60,',
            'gamecubeDiagnostics: {frameSkip:gamecubeFrameSkip.snapshot(),fpsLimit:60,')
    replace('  const initialPresentCount = webGpuExecStats.present;',
            '  const initialPresentCount = webGpuExecStats.present;\n  const initialCompletedFrames = gamecubeFrameSkip.frames;')
    replace('          const fbId = u32[recWord + 1];\n          // Clear intent',
            '''          const fbId = u32[recWord + 1];
          gamecubeSkipDisplayPass = fbId === 0 && gamecubeFrameSkip.skip();
          if (gamecubeSkipDisplayPass) break;
          // Clear intent''')
    # Skip only pass-local state/draw records. Resource uploads, copies, lifetime
    # changes and all non-backbuffer passes still execute in ring order.
    for op in ['SET_PIPELINE','SET_BIND_GROUP','SET_VERTEX_BUFFER','SET_INDEX_BUFFER']:
        anchor = '        case WGPU_CMD_OP_' + op + ': {'
        replace(anchor, anchor + '\n          if (gamecubeSkipDisplayPass) break;')
    for op in ['SET_VIEWPORT','SET_SCISSOR','DRAW','DRAW_INDEXED']:
        anchor = '        case WGPU_CMD_OP_' + op + ':'
        replace(anchor, anchor + '\n          if (gamecubeSkipDisplayPass) break;')
    replace('        case WGPU_CMD_OP_END_PASS:\n',
            '        case WGPU_CMD_OP_END_PASS:\n          gamecubeSkipDisplayPass = false;\n')
    anchor = '''          if (DIAG_DEPTH_TRACE) {
            const pn = self._wgPresentCount || 0;'''
    replace(anchor, '''          if (gamecubeFrameSkip.skip()) {
            // Preserve EFB/copy/upload ordering even when the canvas is not
            // touched. Bound these submissions with the same queue/cap gates.
            ensureEnc();
            if (submitEnc("frame-skip")) {
              gamecubeGpuFrames.submitted(q);
              gamecubeFrameLimit.presented(performance.now());
              gamecubeFrameSkip.complete();
            }
            gamecubeSkipDisplayPass = false;
            break;
          }
''' + anchor)
    replace('          webGpuExecStats.present++;',
            '          webGpuExecStats.present++;\n          gamecubeFrameSkip.complete();')
    replace('    if (webGpuExecStats.present > initialPresentCount) break;',
            '    if (gamecubeFrameSkip.frames > initialCompletedFrames) break;')
    return text
