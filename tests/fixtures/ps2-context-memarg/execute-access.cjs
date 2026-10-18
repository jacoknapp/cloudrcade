const fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
 const memory = new WebAssembly.Memory({initial:4,maximum:32768,shared:true});
 const bytes = new Uint8Array(memory.buffer), view = new DataView(memory.buffer);
 const generators = {}, observations = [];
 for(const name of ['baseline','candidate']) {
  generators[name] = await require('./'+name+'.cjs')({observe:(ctx,address,value)=> {
   observations.push([ctx>>>0,address>>>0,value>>>0,view.getUint32(address>>>0,true)]);
   view.setUint32(address>>>0,0xdeadbeef,true);
  }});
  generators[name]._registerObserver();
 }
 const layout = Array.from({length:4},(_,i)=>generators.baseline._accessLayout(i));
 assert.deepStrictEqual(layout,Array.from({length:4},(_,i)=>generators.candidate._accessLayout(i)));
 const [size,pointerSize,r0,vf0] = layout;
 assert.strictEqual(pointerSize,4,'Must execute real Emscripten layout');
 let seed=0x178934ce,cases=0,kernels=0,identical=0,traps=0,invalidEncodings=0,callCases=0,changed=0,oracleCases=0;
 const corpus=[], corpusCounts=new Map();
 function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
 function build(mode,src,dst,mask=15,kind=1,bound=size){
  const pair={mode,src,dst,mask,kind,bound};
  for(const name of ['baseline','candidate']) {
   const g=generators[name]; let ptr;
   try {ptr=g._generateAccess(mode,src,dst,mask,kind,bound);} catch(e){throw Error('Generation failure '+JSON.stringify({name,mode,src,dst,mask,kind,bound,error:e}));}
   const code=Buffer.from(g.HEAPU8.subarray(ptr,ptr+g._accessSize()));
   let run=null,error=null;
   try {run=new WebAssembly.Instance(new WebAssembly.Module(code),{env:{memory,fctTable:g.codeGenImportTable}}).exports.codeGenFunc;}
   catch(e){error=e.constructor.name;}
   pair[name]={code,run,error};
  }
  assert.strictEqual(pair.baseline.error,pair.candidate.error,'validation parity');
  if(kind===0 || kind===3 || (kind===2 && bound===0)) {assert(pair.baseline.code.equals(pair.candidate.code),'Generic default/reset bytes differ');identical++;}
  if(!pair.baseline.code.equals(pair.candidate.code))changed++;
  if(pair.baseline.error) invalidEncodings++;
  kernels++;
  const category=mode+':'+(src>=size || dst>=size?'boundary':kind);
  if((corpusCounts.get(category)||0)<2) { corpusCounts.set(category,(corpusCounts.get(category)||0)+1); corpus.push({mode,src,dst,mask,kind,bound,baseline:pair.baseline.code.toString('base64'),candidate:pair.candidate.code.toString('base64')}); }
  if(mode===7 && kind===1 && src===128 && dst===192)for(const n of ['baseline','candidate'])fs.writeFileSync(path.join(__dirname,n+'-mixed.wasm'),pair[n].code);
  return pair;
 }
 function input(base,pair,variant=0){
  const result=Buffer.alloc(bytes.length,0xa7);
  for(let i=0;i<size;i+=4)result.writeUInt32LE(random(),base+i);
  // Distinct memory outside the entire context catches incidental stores.
  for(let i=8192;i<8256;i+=4)result.writeUInt32LE(random(),i);
  const p=pair.mode,refLoad=[8,10,12,14,18,19,20].includes(p),refStore=[9,11,13,15,21,22,23].includes(p);
  if(refLoad||refStore){
   const off=base+(refLoad?pair.src:pair.dst),idx=[10,11,14,15].includes(p);
   if(off+8<=result.length){
    let address=variant===1?bytes.length-4:variant===2?0xfffffff0:8192;
    if(variant===3)address=base+pair.src;
    if(variant===4)address=base+pair.dst;
    result.writeUInt32LE(address>>>0,off);
    if(idx)result.writeUInt32LE(variant===2?0x2010:variant===1?32:0,off+4);
   }
  }
  return result;
 }
 function compare(pair,base,initial){
  if(!pair.baseline.run)return;
  const results={};
  for(const name of ['baseline','candidate']){
   bytes.set(initial);observations.length=0;let error=null;
   try{pair[name].run(base);}catch(e){error=e.constructor.name;}
   results[name]={bytes:Buffer.from(bytes),error,calls:JSON.stringify(observations)};
  }
  assert.strictEqual(results.baseline.error,results.candidate.error,JSON.stringify(pair)+' trap mismatch');
  assert(results.baseline.bytes.equals(results.candidate.bytes),`whole memory/canary mismatch mode=${pair.mode} src=${pair.src} dst=${pair.dst} kind=${pair.kind} base=${base}`);
  assert.strictEqual(results.baseline.calls,results.candidate.calls,'Call parameter/order/store observations');
  // Independent byte oracle for raw moves, masked lanes and the two manual
  // conversion emitters. Skip R0's deliberate CMips specialization here.
  const widths=[4,8,4,16,16,4,4], width=widths[pair.mode];
  if(width && pair.src>=64 && pair.src+width<=size && pair.dst+width<=size && base+size<=bytes.length) {
   const expected=Buffer.from(initial), from=base+pair.src, to=base+pair.dst;
   if(pair.mode<=3) initial.copy(expected,to,from,from+width);
   if(pair.mode===4) for(let lane=0;lane<4;lane++)
    if(pair.mask&(1<<lane))initial.copy(expected,to+lane*4,from+lane*4,from+lane*4+4);
   if(pair.mode===5) expected.writeFloatLE(Math.fround(initial.readInt32LE(from)),to);
   if(pair.mode===6) {
    const f=initial.readFloatLE(from);
    const n=Number.isNaN(f)?0:f>=2147483647?2147483647:f<=-2147483648?-2147483648:Math.trunc(f);
    expected.writeInt32LE(n,to);
   }
   assert.strictEqual(results.baseline.error,null,'In-bounds oracle unexpectedly trapped');
   assert(results.baseline.bytes.equals(expected),'Independent raw-byte/conversion oracle mismatch mode='+pair.mode);
   oracleCases++;
  }
  if(results.baseline.error)traps++;
  if(results.baseline.calls!=='[]')callCases++;
  cases++;
 }
 // Source/destination aliasing and mixed nested definitions of every actual width.
 for(let mode=0;mode<=23;mode++) {
  for(const [src,dst] of [[128,192],[128,128],[129,133],[128,132],[128,124]]) {
   const masks=[4,14,15].includes(mode)?(mode===4?Array.from({length:16},(_,i)=>i):Array.from({length:15},(_,i)=>i+1)):[15];
   for(const mask of masks){
    const pair=build(mode,src,dst,mask);
    for(const base of [64,65,bytes.length-size])
     for(let sample=0;sample<5;sample++)compare(pair,base,input(base,pair,sample));
    build(mode,src,dst,mask,0);build(mode,src,dst,mask,3);
   }
  }
 }
 // Relative scalar/vector accesses at signed-LEB and unsigned-LEB boundaries,
 // each width's exact object end and the first byte outside that bound.
 for(const [mode,width] of [[0,4],[1,8],[2,4],[3,16],[5,4],[6,4]]){
  for(const offset of [0,1,63,64,127,128,255,256,size-width,size-width+1,size,size+1,16383,16384,0x7fffffff,0x80000000,0xfffffffc,0xffffffff]){
   for(const [src,dst] of [[offset,96],[96,offset]]){
    const pair=build(mode,src,dst);
    build(mode,src,dst,15,0);build(mode,src,dst,15,3);
    for(const base of [64,bytes.length-size])compare(pair,base,input(base,pair));
   }
  }
  // Tight artificial contract exercises dst/src eligibility independently.
  for(const bound of [0,1,width-1,width,127,128,129,255,256,257,size]){
   for(const [src,dst] of [[128,256],[256,128],[127,128],[bound-width,96],[96,bound-width]]){
    const pair=build(mode,src>>>0,dst>>>0,15,2,bound);
    compare(pair,64,input(64,pair));
   }
  }
 }
 // Exact-end pointer field (4 bytes), with the pointed-to data at an unrelated
 // address. Neither pointer contents nor derived target get a CMIPS bound.
 for(const mode of [8,9,12,13,18,19,20,21,22,23]){
  const load=[8,12,18,19,20].includes(mode);
  for(const field of [size-4,size-3,size,size+4]){
   const pair=build(mode,load?field:128,load?128:field);
   for(let k=0;k<5;k++)compare(pair,64,input(64,pair,k));
  }
 }
 // Conversion edge payloads, no arithmetic approximation or NaN filtering.
 for(const mode of [5,6]) {
  const pair=build(mode,128,132);
  for(const bits of [0,1,0xffffffff,0x80000000,0x7fffffff,0x7f800000,0xff800000,0x7fc01234,0x4f000000,0xcf000000,0x3f7fffff,0xbf800001]){
   const initial=input(64,pair);initial.writeUInt32LE(bits>>>0,192);compare(pair,64,initial);
  }
 }
 // CMipsJitter's real R0 specialization and actual VU destination-zero discard.
 const zero=build(24,128,192);
 for(let i=0;i<64;i++){
  const initial=input(64,zero);compare(zero,64,initial);
  bytes.set(initial);zero.candidate.run(64);
  assert.strictEqual(view.getUint32(64+192,true),0,'R0 must remain constant zero');
  assert(Buffer.from(bytes.subarray(64+vf0,64+vf0+16)).equals(initial.subarray(64+vf0,64+vf0+16)),'VF0 changed');
 }
 // Generic context pointers deliberately remain wrapping, including an invalid
 // whole-object address. Such pointers are EXCLUDED from the opt-in contract.
 for(const kind of [0,3]){
  const pair=build(0,32,36,15,kind),initial=Buffer.alloc(bytes.length,0x5a);
  initial.writeUInt32LE(0x12345678,16);compare(pair,0xfffffff0,initial);
  bytes.set(initial);pair.candidate.run(0xfffffff0);assert.strictEqual(view.getUint32(20,true),0x12345678);
 }
 assert(changed>0 && identical>0 && traps>0 && invalidEncodings>0 && callCases>0);
 const result={cases,kernels,independentOracleCases:oracleCases,genericByteIdentical:identical,changedKernels:changed,trapParityCases:traps,preexistingValidationFailureParity:invalidEncodings,callObservationCases:callCases,contextBytes:size,pointerBytes:pointerSize,comparison:'whole 256KiB linear memory including full CMIPS, canaries, referenced stores and call observations',invalidOptInContextClaim:false,performanceClaim:false};
 fs.writeFileSync(path.join(__dirname,'access-result.json'),JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(__dirname,'portable-generated-corpus.json'),JSON.stringify({layout,modules:corpus},null,2)+'\n');
 console.log('PASS actual bounded context accesses',JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
