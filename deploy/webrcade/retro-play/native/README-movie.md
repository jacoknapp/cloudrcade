# Movie IDCT and diagnostics

`patch-movie.py` validates the exact Framework scalar IDCT hash before replacing
its implementation. Only that translation unit receives `-msimd128` and
`-ffp-contract=off`. Each f64x2 lane computes one independent original output
with the same double coefficients, k order, separate multiply/add and final
`floor(x + 0.5)` plus int/int16 conversion. The original scalar implementation
remains the compile-time fallback. The full first pass precedes output writes,
so aliasing remains supported. There is no zero/DC shortcut.

IPU block completion and CSC conversion gain opt-in diagnostics from
`CloudMovieMetrics.h`, sharing the CPU diagnostics enable/epoch gate. Collection
off performs gate checks without clocks or coefficient scans. Collection on
counts coded/uncoded blocks, zero/DC/AC IDCT blocks and CSC blocks, with about
1/64 pseudorandom timing samples. Times are raw sampled microseconds; they are
inclusive stages, not CPU occupancy or full-decoder time. CSC covers conversion
and writing the output FIFO, excluding its later flush/backpressure wait. Every
toggle resets the visible movie epoch; a timer spanning a toggle is discarded.
Counters are host diagnostics and do not change serialized guest state.

Run the [standalone fixture](../../../../tests/fixtures/ps2-movie/README.md) before
full-core movie/frame, FIFO/state and browser qualification. It compares final
outputs to the exact pinned scalar, checks aliasing, checks metrics lifecycle,
and inspects final linked Wasm instructions. The matrix microbenchmark does not
establish a full-core FPS or phone gain. FIFO and CSC arithmetic remain unchanged
pending actual current-movie counters and separate differential measurements.
