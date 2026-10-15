#!/usr/bin/env python3
"""Cancel the pinned Dawn timed-wait timer when its GPU future wins the race."""
from pathlib import Path
import sys

path = Path(sys.argv[1]) / 'emdawnwebgpu_pkg/webgpu/src/library_webgpu.js'
source = path.read_text()
start = source.index('  emwgpuWaitAny: (futurePtr, futureCount, timeoutMSPtr) => Asyncify.handleAsync(async () => {')
end = source.index('\n  }),', start)
block = source[start:end]
old = 'new Promise((resolve) => setTimeout(resolve, timeoutMS, 0))'
assert block.count(old) == 1
block = block.replace(old, 'new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMS, 0); })')
opening = block.index('\n') + 1
block = (block[:opening] + '    var timeout;\n    try {\n' +
         '\n'.join('  ' + line for line in block[opening:].split('\n')) +
         '\n    } finally {\n      if (timeout !== undefined) clearTimeout(timeout);\n    }')
path.write_text(source[:start] + block + source[end:])
