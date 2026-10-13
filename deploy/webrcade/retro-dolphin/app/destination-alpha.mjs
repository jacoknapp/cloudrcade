// GX can blend RGB with TEV alpha while storing a different, constant alpha.
// WebGPU's baseline blend state has only one source alpha. Replay affected
// draws as RGB then alpha, entirely on the device, without framebuffer copies.
const pairs = new WeakMap();
const sourceAlpha = factor => factor === 4 || factor === 5;

export function destinationAlphaConfig(words, shaders) {
  const offset = 26 + words[25] * 3;
  if (words.length < offset + 2 || words[offset] !== 0x44414c31 ||
      !words[offset + 1] || !words[13] || !(words[14] & 7) ||
      !(sourceAlpha(words[16]) || sourceAlpha(words[17]))) return null;
  const module = shaders.get(words[offset + 1]);
  if (!module) throw new Error('Missing GameCube source-alpha shader');
  return {module};
}

export function createDestinationAlphaPipeline(device, descriptor, config) {
  if (!config) return device.createRenderPipeline(descriptor);
  const target = descriptor.fragment.targets[0];
  const colorDescriptor = {
    ...descriptor,
    label: `${descriptor.label}:blend-color`,
    fragment: {...descriptor.fragment, module: config.module,
      targets: [{...target, writeMask: target.writeMask & 7}]},
    // The alpha pass commits depth with the original comparison. Writing it
    // here then using equal would wrongly accept originally rejected pixels.
    ...(descriptor.depthStencil ? {depthStencil: {
      ...descriptor.depthStencil,
      depthWriteEnabled: (target.writeMask & 8) ? false : descriptor.depthStencil.depthWriteEnabled,
    }} : {}),
  };
  const color = device.createRenderPipeline(colorDescriptor);
  if (!(target.writeMask & 8)) return color;
  const alphaDescriptor = {
    ...descriptor,
    label: `${descriptor.label}:destination-alpha`,
    fragment: {...descriptor.fragment, targets: [{...target, writeMask: 8,
      blend: {color: {srcFactor:'zero', dstFactor:'one', operation:'add'},
        alpha: {srcFactor:'one', dstFactor:'zero', operation:'add'}}}]},
  };
  const alpha = device.createRenderPipeline(alphaDescriptor);
  const factors = target.blend.color;
  // Overlapping primitives must see prior depth/destination-alpha writes.
  // Other blends can replay the whole batch, which keeps fullscreen effects
  // to two draw calls. No CPU pixel readback is used in either path.
  const split = !!descriptor.depthStencil?.depthWriteEnabled ||
    [factors.srcFactor, factors.dstFactor].some(f => f === 'dst-alpha' || f === 'one-minus-dst-alpha');
  const topology = descriptor.primitive.topology;
  let oddColor = color, oddAlpha = alpha;
  if (split && topology === 'triangle-strip') {
    const primitive = {...descriptor.primitive,
      frontFace: descriptor.primitive.frontFace === 'cw' ? 'ccw' : 'cw'};
    oddColor = device.createRenderPipeline({...colorDescriptor, primitive});
    oddAlpha = device.createRenderPipeline({...alphaDescriptor, primitive});
  }
  pairs.set(color, {alpha, split, topology, oddColor, oddAlpha});
  return color;
}

export function drawDestinationAlpha(pass, pipeline, indexed, count, instances, first, baseVertex = 0) {
  const pair = pairs.get(pipeline);
  if (!pair) {
    if (indexed) pass.drawIndexed(count, instances, first, baseVertex, 0);
    else pass.draw(count, instances, first, 0);
    return;
  }
  const draw = (n, k, start, instance) => indexed
    ? pass.drawIndexed(n, k, start, baseVertex, instance)
    : pass.draw(n, k, start, instance);
  if (!pair.split) {
    draw(count, instances, first, 0);
    pass.setPipeline(pair.alpha);
    draw(count, instances, first, 0);
  } else {
    // The native backend disables primitive restart; strip indices contain
    // ordinary vertices only. Preserve alternating winding when splitting.
    const strip = pair.topology === 'triangle-strip';
    const size = pair.topology === 'point-list' ? 1 : pair.topology === 'line-list' ? 2 : 3;
    const step = strip ? 1 : size;
    for (let instance = 0; instance < instances; instance++) {
      for (let i = 0; i + size <= count; i += step) {
        const odd = strip && (i & 1);
        pass.setPipeline(odd ? pair.oddColor : pipeline);
        draw(size, 1, first + i, instance);
        pass.setPipeline(odd ? pair.oddAlpha : pair.alpha);
        draw(size, 1, first + i, instance);
      }
    }
  }
  // The worker's state cache still refers to the color pipeline. Restore the
  // physical binding so a retained pipeline/bind group is valid next draw.
  pass.setPipeline(pipeline);
}
