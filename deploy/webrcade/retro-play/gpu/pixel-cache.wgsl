// Only admitted when every target word has one invocation owner and texture
// reads are immutable or disjoint. Other pipelines retain the original helpers.
var<private> cloud_pixel_cache: bool = false;
var<private> cloud_fb_valid: bool = false;
var<private> cloud_z_valid: bool = false;
var<private> cloud_fb_dirty: bool = false;
var<private> cloud_z_dirty: bool = false;
var<private> cloud_fb_word: u32;
var<private> cloud_z_word: u32;
var<private> cloud_fb_value: u32;
var<private> cloud_z_value: u32;
fn cloud_read_frame(l: Loc, k: u32) -> u32 {
    if (!cloud_pixel_cache) { return load_at(l, k); }
    if (!cloud_fb_valid) {
        cloud_fb_word = l.word;
        cloud_fb_value = atomicLoad(&vram[l.word]);
        cloud_fb_valid = true;
    }
    return cloud_fb_value;
}
fn cloud_write_frame(l: Loc, k: u32, value: u32) {
    if (!cloud_pixel_cache) { store(l, k, value); return; }
    cloud_fb_word = l.word;
    cloud_fb_value = value;
    cloud_fb_valid = true;
    cloud_fb_dirty = true;
}
fn cloud_read_depth(l: Loc, k: u32) -> u32 {
    if (!cloud_pixel_cache) { return load_at(l, k); }
    if (!cloud_z_valid) {
        cloud_z_word = l.word;
        cloud_z_value = atomicLoad(&vram[l.word]);
        cloud_z_valid = true;
    }
    return cloud_z_value & l.mask;
}
fn cloud_write_depth(l: Loc, k: u32, value: u32) {
    if (!cloud_pixel_cache) { store(l, k, value); return; }
    // Z24 shares its upper byte with unrelated VRAM content: retain it exactly.
    if (l.mask != 0xFFFFFFFFu && !cloud_z_valid) {
        cloud_z_value = atomicLoad(&vram[l.word]);
    }
    cloud_z_word = l.word;
    cloud_z_value = (cloud_z_value & ~l.mask) | (value & l.mask);
    cloud_z_valid = true;
    cloud_z_dirty = true;
}
fn cloud_commit_pixel() {
    if (cloud_fb_dirty) { atomicStore(&vram[cloud_fb_word], cloud_fb_value); }
    if (cloud_z_dirty) { atomicStore(&vram[cloud_z_word], cloud_z_value); }
}
