const fs=require('fs'),path=require('path'),assert=require('assert'),{performance}=require('perf_hooks');
(async()=>{
 const generators={};for(const v of ['baseline','candidate'])generators[v]=await require('./'+v+'.cjs')();
 const layout=Array.from({length:12},(_,i)=>generators.baseline._layout(i));assert.deepStrictEqual(layout,Array.from({length:12},(_,i)=>generators.candidate._layout(i)));
 const [size,stateSize,vf,acc,macIndex,stickyIndex,clipIndex,pipeTime]=layout;
 const memory=new WebAssembly.Memory({initial:4,maximum:32768,shared:true}),table=new WebAssembly.Table({initial:1,element:'anyfunc'}),bytes=new Uint8Array(memory.buffer),view=new DataView(memory.buffer);
 const base=64,region=size+128;let rng=0x7a119dee,cases=0,kernels=0,identicalControls=0;
 function rand(){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;}
 const special=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7f800001,0xff800001,0x7fc00000,0xffc00000,0xffffffff,0x55555555,0xaaaaaaaa,0x80808080];
 function build(v,op,mask,alias,hints,count){
  const g=generators[v],ptr=g._generate(op,mask,alias,hints,count),code=Buffer.from(g.HEAPU8.subarray(ptr,ptr+g._generatedSize()));
  if(op===8&&alias===0&&hints===0&&count===1&&(mask===15||mask===5))fs.writeFileSync(path.join(__dirname,v+'-'+(mask===15?'full':'partial')+'.wasm'),code);
  if(op===2&&mask===15&&alias===1&&hints===0&&count===3)fs.writeFileSync(path.join(__dirname,v+'-screen.wasm'),code);
  return{code,fn:new WebAssembly.Instance(new WebAssembly.Module(code),{env:{memory,fctTable:table}}).exports.codeGenFunc};
 }
 function input(seed){
  bytes.fill(0xc3,0,region);
  for(let o=0;o<size;o+=4)view.setUint32(base+o,rand(),true);
  for(const reg of [1,2,3,32])for(let lane=0;lane<4;lane++)view.setUint32(base+vf+reg*16+lane*4,seed<16?special[(seed+reg*3+lane*7)%special.length]:rand(),true);
  for(let lane=0;lane<4;lane++)view.setUint32(base+acc+lane*4,seed<16?special[(seed+lane*5)%special.length]:rand(),true);
  for(let lane=0;lane<4;lane++)view.setUint32(base+vf+lane*4,lane===3?0x3f800000:0,true);
  for(const o of [macIndex,stickyIndex,clipIndex])view.setUint32(base+o,seed&7,true);
  view.setUint32(base+pipeTime,seed&1?0xfffffffd:37,true);
  return Buffer.from(bytes.subarray(0,region));
 }
 function compare(pair,seed,label){
  const initial=input(seed);pair.baseline.fn(base);const expected=Buffer.from(bytes.subarray(0,region));bytes.set(initial);pair.candidate.fn(base);
  const actual=Buffer.from(bytes.subarray(0,region));
  if(!actual.equals(expected)){
   const offset=actual.findIndex((v,i)=>v!==expected[i]);throw Error('VU context differential '+label+' seed='+seed+' offset='+offset+' old='+expected[offset]+' new='+actual[offset]);
  }
  assert.deepStrictEqual(actual.subarray(0,64),initial.subarray(0,64),'leading canary');assert.deepStrictEqual(actual.subarray(base+size),initial.subarray(base+size),'trailing canary');cases++;
 }
 for(const v of ['baseline','candidate'])build(v,8,15,0,0,1);
 for(let op=0;op<14;op++)for(let mask=0;mask<16;mask++)for(let alias=0;alias<7;alias++)for(const hints of [0,1,4,5]){
  const count=(mask+alias+hints)%3===0?3:1,pair={};for(const v of ['baseline','candidate'])pair[v]=build(v,op,mask,alias,hints,count);
  if((op===10&&alias!==3)||op===12||op===13||mask===0){assert(pair.baseline.code.equals(pair.candidate.code),'unchanged producer must emit identical module '+[op,mask,alias,hints,count].join('/'));identicalControls++;}
  for(let seed=0;seed<20;seed++)compare(pair,seed,[op,mask,alias,hints,count].join('/'));
  kernels++;
 }
 // Independent lane sign/zero combinations through real MUL+masked write+pipelines.
 for(let mask=0;mask<16;mask++){
  const pair={baseline:build('baseline',8,mask,0,4,1),candidate:build('candidate',8,mask,0,4,1)};
  for(let signs=0;signs<16;signs++)for(let zeros=0;zeros<16;zeros++){
   const initial=input(0);
   for(let lane=0;lane<4;lane++){
    const raw=(((signs>>>lane)&1?0x80000000:0)|((zeros>>>lane)&1?0:0x3f800000))>>>0;
    view.setUint32(base+vf+16+lane*4,raw,true);view.setUint32(base+vf+32+lane*4,0x3f800000,true);
   }
   const src=Buffer.from(bytes.subarray(0,region)),idx=view.getUint32(base+macIndex,true),sidx=view.getUint32(base+stickyIndex,true),oldSticky=view.getUint32(base+layout[9]+((sidx-1)&7)*4,true);
   let flags=0;for(let lane=0;lane<4;lane++)if(mask&(8>>>lane)){if(signs&(1<<lane))flags|=1<<(7-lane);if(zeros&(1<<lane))flags|=1<<(3-lane);}
   pair.baseline.fn(base);const expected=Buffer.from(bytes.subarray(0,region));bytes.set(src);pair.candidate.fn(base);assert.deepStrictEqual(Buffer.from(bytes.subarray(0,region)),expected);
   assert.strictEqual(view.getUint32(base+layout[8]+idx*4,true),flags,'independent MAC flag oracle');assert.strictEqual(view.getUint32(base+layout[9]+sidx*4,true),(flags|oldSticky)>>>0,'independent sticky flag oracle');cases++;
  }
 }
 // Balanced actual VU+pipeline sequence screen only; no whole-game claim.
 const pair={baseline:build('baseline',2,15,1,0,3),candidate:build('candidate',2,15,1,0,3)},times={baseline:[],candidate:[]};
 input(8);for(let i=0;i<10000;i++){pair.baseline.fn(base);pair.candidate.fn(base);}
 for(const v of ['baseline','candidate','candidate','baseline','baseline','candidate','candidate','baseline']){input(8);const start=performance.now();for(let i=0;i<200000;i++)pair[v].fn(base);times[v].push(performance.now()-start);}
 const result={kernels,cases,identicalControlKernels:identicalControls,contextBytes:size,stateBytes:stateSize,canaryBytes:128,operations:['ADD','ADDA','MADD','MADDA','SUB','SUBA','MSUB','MSUBA','MUL','MULA','ADDbc move control','MULbc','ADDi control','OPMSUB scalar control'],allMasks:16,aliasModes:7,hints:[0,1,4,5],screenMs:times,gamePerformanceClaim:false};
 fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS actual VUShared + CMipsJitter execution',JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
