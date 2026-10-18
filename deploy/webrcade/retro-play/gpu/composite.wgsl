// CloudRcade display-circuit composition in PS2 draw order (GPL-3.0).
@compute @workgroup_size(8, 8)
fn cloud_composite(@builtin(global_invocation_id) gid: vec3<u32>) {
    let width = prm(0u) * SCALE;
    let height = prm(1u) * SCALE;
    if (gid.x >= width || gid.y >= height) { return; }
    var color = vec3<u32>(0u);
    for (var layer = 0u; layer < 2u; layer++) {
        let base = 4u + layer * 12u;
        if (prm(base) == 0u) { continue; }
        let ox = prm(base + 1u) * SCALE;
        let oy = prm(base + 2u) * SCALE;
        if (gid.x < ox || gid.y < oy) { continue; }
        let x = gid.x - ox;
        let y = gid.y - oy;
        if (x >= prm(base + 3u) * SCALE || y >= prm(base + 4u) * SCALE) { continue; }
        let psm = prm(base + 7u);
        var pixel = read_sample(psm, prm(base + 5u), prm(base + 6u), prm(base + 10u) + x / SCALE, prm(base + 11u) + y / SCALE, (y % SCALE) * SCALE + x % SCALE);
        if (psm == PSMCT16 || psm == PSMCT16S) {
            pixel = ((pixel & 0x1Fu) << 3u) | ((pixel & 0x3E0u) << 6u) | ((pixel & 0x7C00u) << 9u) | ((pixel & 0x8000u) << 16u);
        }
        let rgb = vec3<u32>(pixel & 255u, (pixel >> 8u) & 255u, (pixel >> 16u) & 255u);
        if (layer == 0u) { color = rgb; }
        else {
            let alpha = min(select(pixel >> 24u, prm(base + 9u), prm(base + 8u) != 0u), 128u);
            color = (rgb * alpha + color * (128u - alpha)) / 128u;
        }
    }
    scratch[prm(2u) + gid.y * width + gid.x] = color.x | (color.y << 8u) | (color.z << 16u) | 0xFF000000u;
}
