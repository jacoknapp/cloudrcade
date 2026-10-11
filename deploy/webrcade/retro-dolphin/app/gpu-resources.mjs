// Commands already submitted to the GPU retain their bind groups. Buffers and
// textures must be submitted before destroy(), which invalidates future use.
export function releaseGpuResource(maps, tag, id, {flush, invalidate = () => {}}) {
  const map = tag === 1 ? maps.buffers : tag === 2 ? maps.textures :
    tag === 3 ? maps.bindGroups : null;
  const resource = map?.get(id);
  if (!resource) return true;
  if (tag !== 3 && !flush()) return false;
  invalidate(tag, resource);
  if (tag === 1) resource.destroy();
  if (tag === 2) resource.tex.destroy();
  map.delete(id);
  if (tag === 3) maps.bindGroupSamplingMasks.delete(id);
  return true;
}
