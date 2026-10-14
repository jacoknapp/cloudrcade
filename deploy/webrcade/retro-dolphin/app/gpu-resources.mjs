// Commands already submitted to the GPU retain their bind groups. Buffers and
// textures must be submitted before destroy(), which invalidates future use.
export function releaseGpuResource(maps, tag, id, {flush, invalidate = () => {}, metadata = {}}) {
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
  // Producer IDs increase for the whole session. These auxiliary tables must
  // follow the resource lifetime too, even when diagnostic logs are suppressed.
  if (tag === 3) {
    if (metadata._wgBgTex) delete metadata._wgBgTex[id];
    if (metadata._wgBgAll) delete metadata._wgBgAll[id];
  }
  if (tag === 2) {
    if (metadata._wgRT) delete metadata._wgRT[id];
    if (metadata._wgPassDiag) delete metadata._wgPassDiag['fb' + id];
    if (metadata._wgFbDraws) delete metadata._wgFbDraws['fb' + id];
    metadata._wgCopyTargets?.delete(id);
  }
  return true;
}
