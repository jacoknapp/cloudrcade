@compute @workgroup_size(64)
fn decode(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
    let group = wid.x + wid.y * 1024u;
    if (group >= prm(2u)) { return; }
    // Each workgroup owns one independent 64-texel portion of a decode job.
    let jobs = prm(0u);
    var lo = 0u;
    var hi = prm(1u);
    while (lo + 1u < hi) {
        let mid = (lo + hi) / 2u;
        if (data[jobs + mid * 4u + 3u] <= group) { lo = mid; }
        else { hi = mid; }
    }
    let job = jobs + lo * 4u;
    let i = (group - data[job + 3u]) * 64u + lane;
    if (i >= data[job + 2u]) { return; }
    let s = load_setup(data[job]);
    let x = i & ((1u << s.tw) - 1u);
    let y = i >> s.tw;
    decoded[data[job + 1u] + i] = convert(s, load_at(addr(s.tf, x, y), 0u));
}
