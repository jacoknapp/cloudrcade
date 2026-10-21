"""Use native graphics frame skipping and consume its ordered frame markers.

Native XFB metadata determines presentation; host cadence must never display an
omitted native frame or independently drop another frame after native rendering.
"""
def patch_frame_skip(text):
    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise RuntimeError('Unexpected frame-skip anchor: ' + old[:90])
        text = text.replace(old, new)

    text = 'import {FrameSkip} from "../../frame-skip.mjs";\nconst gamecubeFrameSkip = new FrameSkip();\n' + text
    replace('    getFrame: cwrap("GetFrame", "number", []),', '''    getFrame: cwrap("GetFrame", "number", []),
    setGraphicsFrameSkip: cwrap("SetGraphicsFrameSkip", null, ["number"]),
    getGraphicsFrameSkipStats: cwrap("GetGraphicsFrameSkipStats", "string", []),''')
    replace('    case "nativeTiming": {', '''    case "frameSkip": {
      const divisor=gamecubeFrameSkip.set(payload.divisor);
      api.setGraphicsFrameSkip(divisor);
      return {divisor};
    }
    case "nativeTiming": {''')
    replace('gamecubeDiagnostics: {fpsLimit:60,',
            'gamecubeDiagnostics: {frameSkip:{...gamecubeFrameSkip.snapshot(),native:JSON.parse(api.getGraphicsFrameSkipStats())},fpsLimit:60,')
    replace('  const initialPresentCount = webGpuExecStats.present;',
            '  const initialPresentCount = webGpuExecStats.present;\n  const initialCompletedFrames = gamecubeFrameSkip.frames;')
    anchor = '''          if (DIAG_DEPTH_TRACE) {
            const pn = self._wgPresentCount || 0;'''
    replace(anchor, '''          if (u32[recWord + 1] === 1) {
            // Native omitted graphics and the canvas pass for this XFB. Submit
            // retained copies/transfers in order, with the usual queue gates.
            ensureEnc();
            if (submitEnc("frame-skip")) {
              gamecubeGpuFrames.submitted(q);
              gamecubeFrameLimit.presented(performance.now());
              gamecubeFrameSkip.complete(true);
            }
            break;
          }
''' + anchor)
    replace('          webGpuExecStats.present++;',
            '          webGpuExecStats.present++;\n          gamecubeFrameSkip.complete(false);')
    replace('    if (webGpuExecStats.present > initialPresentCount) break;',
            '    if (gamecubeFrameSkip.frames > initialCompletedFrames) break;')
    return text
