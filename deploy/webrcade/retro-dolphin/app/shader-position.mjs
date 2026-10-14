// Identical positions across programs/pipeline variants must receive identical
// depth, including coplanar shadow passes. Fragment position inputs cannot carry
// @invariant; only transform the translated vertex stage's position output.
export function invariantVertexPosition(wgsl, stage) {
  if(stage!==0)return wgsl;
  return wgsl.replace(/(?:@invariant\s+)?@builtin\(\s*position\s*\)(?!\s*@invariant)/g,'@invariant @builtin(position)');
}
