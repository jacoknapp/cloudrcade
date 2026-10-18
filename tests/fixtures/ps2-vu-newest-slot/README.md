# VU newest-slot flag reader

Run from the repository with a retained pinned Play source tree and matching
CodeGen/Framework archives:

```sh
python3 tests/test_webrcade_ps2_vu_newest_slot.py \
  --play /path/to/installed/Play \
  --libraries-play /path/to/retained/build/Play \
  --output /tmp/new-empty-vu-newest-slot-proof
```

The runner mounts both inputs read-only, checks the actual VU/Wasm emitter
sources and all retained CodeGen/Framework C/C++ headers/sources, and compiles a
small C++ generator with the pinned SDK. It does not build Play, access games,
or use a GPU. Both generators compile the complete actual VUShared.cpp with
CMipsJitter and the unchanged Wasm backend; only the candidate flag reader is
patched. MakeSz and computed-result forwarding are absent from both variants.

Node executes both generated modules against an independent state oracle.
The fixture compares all CMIPS bytes and leading/trailing canaries for MAC,
sticky and CLIP reads, GetStatus, repeated reads, queue/read and reset/read
sequences. All eight indices and all 256 eligibility masks are exhausted at
four signed thresholds; additional arbitrary timestamps and wrap constants
cover signed/unsigned disagreement. The original Wasm backend emits signed
`i32.le_s` after wrapping 32-bit addition. The unsigned immediate C++ reader is
therefore deliberately not the wraparound oracle. No timestamp uses i64.

The candidate first checks the final slot of the original traversal. When that
slot is mature its value wins regardless of all earlier slots, even with
unsorted archived timestamps. Otherwise the complete old scan runs. Queued
values, times, index and emulated latency remain unchanged. Existing callers
enter this helper with an empty Jitter stack, which is required by BeginIf.
Queue/reset-only controls must generate byte-identical modules; repeat patching
must fail closed.

The initial proof passed 50,784 cases across 129 generated kernel pairs,
including 21 byte-identical queue/reset controls. The direct reader grows from
722 to 833 generated Wasm bytes. Separate local Node 22/V8 12.4 forced-TurboFan
inspection retained the baseline's eight flag stores and 33 state loads; the
successful candidate branch has one store and five loads. The fallback adds
three loads and a conditional branch. Native instruction bytes grew 380 to
440 (both padded bodies 448). This is local code-generation evidence, not
current browser/iPhone throughput or a game eligibility rate.

Whole-game selection still needs fresh hot-module relevance and balanced
uninstrumented controls. A diagnostic-only hit-count factor could emit private
host counter increments in the true/false branches, separately for each ring;
it must retain the same signed predicate and exclude the counters from guest
state. Such a factor is not implemented or shipped here. Its measurements
would establish eligibility, not performance. Source and archive hashes,
generated modules, counts and provenance are written to the chosen output.
