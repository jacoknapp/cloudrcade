const assert = require('node:assert/strict');
(async () => {
  const {destinationAlphaConfig, createDestinationAlphaPipeline, drawDestinationAlpha} =
    await import('../deploy/webrcade/retro-dolphin/app/destination-alpha.mjs');
  const words = new Uint32Array(31); // one vertex attribute, then optional trailer
  words[25]=1;words[29]=0x44414c31;words[30]=42;words[13]=1;words[14]=15;words[16]=4;words[17]=5;
  const module={};const shaders=new Map([[42,module]]);
  assert.deepEqual(destinationAlphaConfig(words,shaders),{module});
  assert.equal(destinationAlphaConfig(words.subarray(0,29),shaders),null,'legacy pipeline');
  const variant=words.slice();variant[16]=1;variant[17]=0;
  assert.equal(destinationAlphaConfig(variant,shaders),null,'no source alpha dependency');
  variant[16]=4;variant[14]=8;
  assert.equal(destinationAlphaConfig(variant,shaders),null,'alpha-only draw');
  assert.throws(()=>destinationAlphaConfig(words,new Map()),/Missing/);
  const calls=[];const device={createRenderPipeline:d=>({d})};
  const descriptor={label:'ordinary',fragment:{targets:[{writeMask:15}]},primitive:{topology:'triangle-list'}};
  const ordinary=createDestinationAlphaPipeline(device,descriptor,null);
  assert.equal(ordinary.d,descriptor,'ordinary pipeline retains its descriptor');
  const pass={drawIndexed:(...args)=>calls.push(args),setPipeline:()=>assert.fail('ordinary draw changed pipeline')};
  drawDestinationAlpha(pass,ordinary,true,9,2,3,-4);
  assert.deepEqual(calls,[[9,2,3,-4,0]],'indexed offsets/instances unchanged');
  console.log('PASS GameCube destination-alpha protocol selects only affected draws; legacy and ordinary draws unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});
