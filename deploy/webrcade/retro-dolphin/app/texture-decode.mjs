// SPDX-License-Identifier: GPL-2.0-or-later
// GX tiled texture conversion. The input snapshot includes its palette; the only
// output is the selected RGBA8 GPU mip. Rendering still uses the owning WebGPU device.
export const TEXTURE_DECODE_OP = 26;
export const TEXTURE_DECODE_MAX_BYTES = 16 + 1024 * 1024 * 4 + 32768;
const formats = new Map([
  [0, [8, 8, 32, 0]], [1, [8, 4, 32, 0]], [2, [8, 4, 32, 0]],
  [3, [4, 4, 32, 0]], [4, [4, 4, 32, 0]], [5, [4, 4, 32, 0]],
  [6, [4, 4, 64, 0]], [8, [8, 8, 32, 32]], [9, [8, 4, 32, 512]],
  [10, [4, 4, 32, 32768]], [14, [8, 8, 32, 0]],
]);

export function validateTextureDecode(packet, width, height, alignedWidth, mip, texture) {
  if (!(packet instanceof Uint8Array) || packet.byteLength < 16 ||
      packet.byteLength > TEXTURE_DECODE_MAX_BYTES || packet.byteLength % 4) {
    throw new Error('Invalid GX decode packet size');
  }
  const header = new DataView(packet.buffer, packet.byteOffset, 16);
  const format = header.getUint32(0, true), paletteFormat = header.getUint32(4, true);
  const dataBytes = header.getUint32(8, true), paletteBytes = header.getUint32(12, true);
  const layout = formats.get(format);
  if (!layout || ![width, height, alignedWidth, mip].every(Number.isSafeInteger) ||
      width < 1 || height < 1 || width > 1024 || height > 1024 || mip < 0 || mip > 10) {
    throw new Error('Invalid GX decode format or dimensions');
  }
  const [bw, bh, blockBytes, paletteSize] = layout;
  if (alignedWidth !== Math.ceil(width / bw) * bw ||
      dataBytes !== (alignedWidth / bw) * Math.ceil(height / bh) * blockBytes ||
      paletteBytes !== paletteSize || (paletteBytes && paletteFormat > 2) ||
      packet.byteLength !== 16 + dataBytes + paletteBytes ||
      texture?.format !== 'rgba8unorm' || !texture.tex || mip >= texture.tex.mipLevelCount ||
      width !== Math.max(1, texture.tex.width >> mip) ||
      height !== Math.max(1, texture.tex.height >> mip) || texture.layers !== 1) {
    throw new Error('GX decode source or destination mismatch');
  }
  return {format, dataBytes, paletteBytes};
}

export const textureDecodeWGSL = /* wgsl */ `
struct Params { width: u32, height: u32, aligned_width: u32, unused: u32 }
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var output_image: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: Params;
fn byte_at(p: u32) -> u32 { return (source[4u + p / 4u] >> ((p & 3u) * 8u)) & 255u; }
fn be16(p: u32) -> u32 { return (byte_at(p) << 8u) | byte_at(p + 1u); }
fn e3(x: u32) -> u32 { return (x << 5u) | (x << 2u) | (x >> 1u); }
fn e4(x: u32) -> u32 { return x * 17u; }
fn e5(x: u32) -> u32 { return (x << 3u) | (x >> 2u); }
fn e6(x: u32) -> u32 { return (x << 2u) | (x >> 4u); }
fn rgb565(x: u32) -> vec4u { return vec4u(e5(x >> 11u), e6((x >> 5u) & 63u), e5(x & 31u), 255u); }
fn rgb5a3(x: u32) -> vec4u {
  if ((x & 32768u) != 0u) { return vec4u(e5((x >> 10u) & 31u), e5((x >> 5u) & 31u), e5(x & 31u), 255u); }
  return vec4u(e4((x >> 8u) & 15u), e4((x >> 4u) & 15u), e4(x & 15u), e3((x >> 12u) & 7u));
}
fn palette(index: u32) -> vec4u {
  let offset = source[2] + index * 2u;
  switch source[1] {
    case 0u: { let i = byte_at(offset + 1u); return vec4u(i, i, i, byte_at(offset)); }
    case 1u: { return rgb565(be16(offset)); }
    default: { return rgb5a3(be16(offset)); }
  }
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) pos: vec3u) {
  if (pos.x >= params.width || pos.y >= params.height) { return; }
  let format = source[0];
  var bw = 4u; var bh = 4u; var block_bytes = 32u;
  if (format == 0u || format == 8u || format == 14u) { bw = 8u; bh = 8u; }
  if (format == 1u || format == 2u || format == 9u) { bw = 8u; }
  if (format == 6u) { block_bytes = 64u; }
  let tile = ((pos.y / bh) * (params.aligned_width / bw) + pos.x / bw) * block_bytes;
  let pixel = (pos.y % bh) * bw + pos.x % bw;
  var color = vec4u(0u);
  switch format {
    case 0u, 8u: {
      let nibble = (byte_at(tile + pixel / 2u) >> (4u - (pixel & 1u) * 4u)) & 15u;
      if (format == 8u) { color = palette(nibble); }
      else { color = vec4u(e4(nibble)); }
    }
    case 1u: { color = vec4u(byte_at(tile + pixel)); }
    case 2u: { let value = byte_at(tile + pixel); let i = e4(value & 15u); color = vec4u(i, i, i, e4(value >> 4u)); }
    case 3u: { let offset = tile + pixel * 2u; let i = byte_at(offset + 1u); color = vec4u(i, i, i, byte_at(offset)); }
    case 4u: { color = rgb565(be16(tile + pixel * 2u)); }
    case 5u: { color = rgb5a3(be16(tile + pixel * 2u)); }
    case 6u: { let offset = tile + pixel * 2u; color = vec4u(byte_at(offset + 1u), byte_at(offset + 32u), byte_at(offset + 33u), byte_at(offset)); }
    case 9u: { color = palette(byte_at(tile + pixel)); }
    case 10u: { color = palette(be16(tile + pixel * 2u) & 16383u); }
    case 14u: {
      let sub = tile + ((pos.y % 8u) / 4u * 2u + (pos.x % 8u) / 4u) * 8u;
      let a = be16(sub); let b = be16(sub + 2u);
      let ca = rgb565(a); let cb = rgb565(b);
      let selector = (byte_at(sub + 4u + pos.y % 4u) >> (6u - (pos.x % 4u) * 2u)) & 3u;
      switch selector {
        case 0u: { color = ca; }
        case 1u: { color = cb; }
        default: {
          if (a > b) {
            // GX uses 3/8 and 5/8, not desktop BC1's 1/3 and 2/3.
            if (selector == 2u) { color = (ca * 5u + cb * 3u) >> vec4u(3u); }
            else { color = (ca * 3u + cb * 5u) >> vec4u(3u); }
          } else {
            color = (ca + cb) / 2u;
            // GX transparent CMPR retains average RGB instead of transparent black.
            if (selector == 3u) { color.a = 0u; }
          }
        }
      }
    }
    default: { return; }
  }
  textureStore(output_image, vec2i(pos.xy), vec4f(color) / 255.0);
}`;

const pipelines = new WeakMap();
function pipelineFor(device) {
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    const layout = device.createBindGroupLayout({entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: {access: 'write-only', format: 'rgba8unorm', viewDimension: '2d'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform', minBindingSize: 16}},
    ]});
    pipeline = device.createComputePipeline({
      label: 'GX tiled texture decode',
      layout: device.createPipelineLayout({bindGroupLayouts: [layout]}),
      compute: {module: device.createShaderModule({code: textureDecodeWGSL}), entryPoint: 'main'},
    });
    pipelines.set(device, pipeline);
  }
  return pipeline;
}

// Buffers are immutable for this encoding. Caller destroys them only after its
// command buffer was submitted (or abandoned), never while it awaits submission.
export function encodeTextureDecode(device, encoder, texture, packet, width, height, alignedWidth, mip) {
  const info = validateTextureDecode(packet, width, height, alignedWidth, mip, texture);
  const pipeline = pipelineFor(device);
  const buffers = [];
  try {
    const source = device.createBuffer({size: packet.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true});
    buffers.push(source);
    new Uint8Array(source.getMappedRange()).set(packet);
    source.unmap();
    const params = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true});
    buffers.push(params);
    new Uint32Array(params.getMappedRange()).set([width, height, alignedWidth, 0]);
    params.unmap();
    const group = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: {buffer: source}},
      {binding: 1, resource: texture.tex.createView({dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: 0, arrayLayerCount: 1})},
      {binding: 2, resource: {buffer: params}},
    ]});
    const pass = encoder.beginComputePass({label: 'GX decode'});
    pass.setPipeline(pipeline); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    return {buffers, ...info, bytes: packet.byteLength + 16};
  } catch (error) {
    for (const buffer of buffers) buffer.destroy();
    throw error;
  }
}
