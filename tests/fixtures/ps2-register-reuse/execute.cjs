const fs=require('fs'),assert=require('assert');
(async()=>{
 const memory=new WebAssembly.Memory({initial:4,maximum:32768,shared:true});
 const bytes=new Uint8Array(memory.buffer),view=new DataView(memory.buffer),generators={},observations=[];let reentryRun=null;
 for(const name of ['baseline','candidate']){
  generators[name]=await require('./'+name+'.cjs')({observe:(ctx,src,out)=>{
   ctx>>>=0;src>>>=0;out>>>=0;
   observations.push({ctx,src,out,source:Buffer.from(bytes.subarray(ctx+src,ctx+src+16)).toString('hex'),stored:Buffer.from(bytes.subarray(ctx+out,ctx+out+16)).toString('hex')});
   if(reentryRun)reentryRun(ctx);else view.setUint32(ctx+src,0xdedcab89,true);
  }});generators[name]._registerObserver();
 }
 const layout=Array.from({length:12},(_,i)=>generators.baseline._layout(i));
 assert.deepStrictEqual(layout,Array.from({length:12},(_,i)=>generators.candidate._layout(i)));
 const [size,pointer,r0,vf0,acc,flags,ctl,stateBase,stateGpr,stateVf,registerWidth,stateSize]=layout;assert.strictEqual(pointer,4);
 assert.strictEqual(r0,stateBase+stateGpr);assert.strictEqual(vf0,stateBase+stateVf);assert.strictEqual(registerWidth,16);assert(size>=stateBase+stateSize);
 const out=r0+16*16,second=r0+2*16,widths=[4,8,4,16];
 let seed=0xc8e7213f,kernels=0,cases=0,oracles=0,traps=0,calls=0,changed=0,identical=0,knownBaselineOracleFailures=0,knownBaselineEncodingFailures=0;
 const negatives=[],positives=[],corpusKernels=[],corpusCases=[],metadata=[],portableSeen=new Set(),reentryKernels=new Map();
 function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
 function build(mode,type,src,arg=0,kind=1){
  const p={id:kernels,mode,type,src,arg,kind};
  for(const n of ['baseline','candidate']){
   const g=generators[n];let ptr;
   try{ptr=g._generate(mode,type,src,arg,kind);}catch(e){throw new Error('actual emitter generation failed '+JSON.stringify({mode,type,src,arg,kind,variant:n,error:String(e)}));}
   const code=Buffer.from(g.HEAPU8.subarray(ptr,ptr+g._size()));
   let run=null,error=null;
   try{run=new WebAssembly.Instance(new WebAssembly.Module(code),{env:{memory,fctTable:g.codeGenImportTable}}).exports.codeGenFunc;}catch(e){error=e.constructor.name;}
   p[n]={code,run,error};
   if(kind===3)p[n].disabled=Buffer.from(g.HEAPU8.subarray(g._disabledPtr(),g._disabledPtr()+g._disabledSize()));
  }
  assert.strictEqual(p.baseline.error,p.candidate.error,'validation parity '+JSON.stringify({mode,type,src,arg,kind}));
  if(p.baseline.error){assert(mode===12&&[0xffff0000,0xffffffff].includes(arg),'unexpected invalid encoding '+JSON.stringify({mode,type,src,arg,kind}));knownBaselineEncodingFailures++;}
  const same=p.baseline.code.equals(p.candidate.code);if(same)identical++;else changed++;
  if(kind===0||kind===2){assert(same,'Generic/disabled backend byte drift '+JSON.stringify({mode,type,src,arg,kind}));negatives.push([mode,type,src,arg,kind]);}
  if(mode===0&&kind===1&&src===r0+16){
   assert(!same,'Missing actual read reuse for width '+type);positives.push(type);
   for(const n of ['baseline','candidate'])fs.writeFileSync(__dirname+'/'+n+'-positive'+type+'.wasm',p[n].code);
  }
  const moduleFolder=p.baseline.error?'known-invalid-encodings':'modules';
  fs.mkdirSync(__dirname+'/'+moduleFolder,{recursive:true});
  for(const n of ['baseline','candidate'])fs.writeFileSync(__dirname+'/'+moduleFolder+'/'+kernels+'-'+n+'.wasm',p[n].code);
  if(kind===3)assert(p.baseline.disabled.equals(p.candidate.disabled),'same-backend disable byte identity');
  metadata.push({id:p.id,mode,type,src,arg,kind});
  corpusKernels.push({id:p.id,mode,type,src,arg,kind,error:p.baseline.error,baseline:p.baseline.code.toString('base64'),candidate:p.candidate.code.toString('base64'),...(kind===3?{disabled:p.baseline.disabled.toString('base64')}:{})});
  kernels++;return p;
 }
 function initial(base,p,bits){
  const data=Buffer.alloc(bytes.length,0xa7);
  for(let k=0;k<size;k+=4)data.writeUInt32LE(rand(),base+k);
  for(let lane=0;lane<4;lane++)data.writeUInt32LE(bits===undefined?rand():((bits+lane*0x1000000)>>>0),base+p.src+lane*4);
  data.writeUInt32LE(p.mode===6?(bits&1):3,base+ctl);return data;
 }
 function copyRead(target,source,p,base,dst){
  if((p.type===0||p.type===1)&&p.src>=r0&&p.src+widths[p.type]<=r0+16)target.fill(0,base+dst,base+dst+widths[p.type]);
  else source.copy(target,base+dst,base+p.src,base+p.src+widths[p.type]);
  if(p.type===2){const value=target.readUInt32LE(base+dst);target.writeUInt32LE((dst===out+16?(value&0x7fffffff):(value^0x80000000))>>>0,base+dst);}
 }
 function expected(p,base,input){
  if([9,10,12,13,15,16,17].includes(p.mode))return null;
  const result=Buffer.from(input);
  copyRead(result,input,p,base,out);
  if(p.mode===1)result.writeUInt32LE(0xa8123456,base+p.src+p.arg);
  if(p.mode===2)result.writeUInt32LE(0xa8123456,base+second);
  if(p.mode===3)for(let lane=0;lane<4;lane++)if(p.arg&(1<<lane))input.copy(result,base+p.src+lane*4,base+second+lane*4,base+second+lane*4+4);
  if(p.mode===4)result.writeUInt32LE(0xdedcab89,base+p.src);
  if(p.mode===5){
   if(p.arg>=32){for(let lane=0;lane<4;lane++)if(p.arg&(1<<lane))input.copy(result,base+p.src+lane*4,base+second+lane*4,base+second+lane*4+4);}
   else input.copy(result,base+p.src,base+second,base+second+p.arg);
  }
  if(p.mode===6)result.writeUInt32LE(input.readUInt32LE(base+ctl)?0x89345678:0x98456789,base+p.src);
  if(p.mode===11){
   const at=base+p.src;
   if(p.type===0)result.writeUInt32LE((result.readUInt32LE(at)+1)>>>0,at);
   if(p.type===1)result.writeBigUInt64LE(BigInt.asUintN(64,result.readBigUInt64LE(at)+1n),at);
   if(p.type===2)result.writeUInt32LE((result.readUInt32LE(at)^0x80000000)>>>0,at);
   if(p.type===3)for(let k=0;k<16;k++)result[at+k]^=255;
  }
  if(p.mode===7){copyRead(result,result,p,base,out+32);result.writeUInt32LE(0,base+ctl);}
  copyRead(result,result,p,base,out+16);return result;
 }
 function compare(p,base,input){
  if(p.baseline.error)return;
  let reentry=null;
  if(p.mode===4){
   if(!reentryKernels.has(p.src))reentryKernels.set(p.src,build(18,0,p.src));
   reentry=reentryKernels.get(p.src);
  }
  const results={};
  for(const n of ['baseline','candidate']){
   bytes.set(input);observations.length=0;let error=null;
   try{reentryRun=reentry?reentry[n].run:null;p[n].run(base);reentryRun=null;}catch(e){error=e.constructor.name;}
   results[n]={bytes:Buffer.from(bytes),calls:JSON.stringify(observations),error};
  }
  const label=JSON.stringify({mode:p.mode,type:p.type,src:p.src,arg:p.arg,kind:p.kind,base});
  assert.strictEqual(results.baseline.error,results.candidate.error,'trap order '+label);
  assert(results.baseline.bytes.equals(results.candidate.bytes),'whole context/memory/canary '+label);
  assert.strictEqual(results.baseline.calls,results.candidate.calls,'helper observation/store order '+label);
  const oracle=expected(p,base,input);
  if(oracle){assert.strictEqual(results.baseline.error,null,label);assert(results.baseline.bytes.equals(oracle),'independent byte oracle '+label);oracles++;}
  if(results.baseline.error)traps++;
  if(results.baseline.calls!=='[]'){
   calls++;
   const observed=JSON.parse(results.baseline.calls);assert.strictEqual(observed.length,1);
   const first=Buffer.from(input);copyRead(first,input,p,base,out);
   assert.strictEqual(observed[0].stored,first.subarray(base+out,base+out+16).toString('hex'),'observer must see preceding ordered committed store');
   assert.strictEqual(observed[0].source,input.subarray(base+p.src,base+p.src+16).toString('hex'));
  }
  if(p.mode===17){
   assert(results.baseline.bytes.equals(expected({...p,mode:0},base,input)),'known full-mask frontend negative changed');
   assert(!results.baseline.bytes.equals(expected({...p,mode:5,arg:47},base,input)),'known full-mask intended-store oracle unexpectedly passed');
   knownBaselineOracleFailures++;
  }
  if(p.mode===12){
   if(p.arg===0xffffffff){
    assert.strictEqual(results.baseline.error,null,'wrapping prior operand is valid');
    const want=Buffer.from(input);want.writeUInt32LE((input.readUInt32LE(base-1)+input.readUInt32LE(base+p.src))>>>0,base+out+32);copyRead(want,want,p,base,out+16);
    assert(results.baseline.bytes.equals(want),'wrapping operand independent oracle');oracles++;
   }else{assert.strictEqual(results.baseline.error,'RuntimeError','trap negative control must trap');assert(results.baseline.bytes.equals(input),'earlier trapping operand must prevent all stores');}
  }
  const sampleKey=p.id+':'+((p.mode===0&&p.kind===1&&base===64)?input.readUInt32LE(base+p.src):'first');
  if(!portableSeen.has(sampleKey)){
   portableSeen.add(sampleKey);
   corpusCases.push({kernel:p.id,base,input:input.subarray(base,base+size).toString('base64'),expected:results.baseline.bytes.subarray(base,base+size).toString('base64'),trap:results.baseline.error,calls:JSON.parse(results.baseline.calls),knownFullMaskOracleFailure:p.mode===17,reentry:reentry?reentry.id:null});
  }
  cases++;
 }
 const edges=[0,0x80000000,0x7fc01234,0x7fa54321,0xffc01234,0x7f800000,0xff800000,1,0x007fffff,0xffffffff,0x3f800000];
 for(const type of [0,1,2,3])for(const family of [r0,vf0]){
  const src=family+16;
  for(const mode of [0,1,2,4,6,7,11]){
   const args=mode===1?[0,1,3,4,7,12]:[0];
   for(const arg of args){
    const p=build(mode,type,src,arg);
    for(const kind of [0,2]){const q=build(mode,type,src,arg,kind);compare(q,64,initial(64,q,0x7fc01234));}
    for(const base of [64,65,bytes.length-size])for(const bits of edges)compare(p,base,initial(base,p,bits));
   }
  }
 }
 for(const type of [0,1,2,3])for(let mask=1;mask<=15;mask++){
  const p=build(3,type,vf0+16,mask);for(const bits of edges)compare(p,64,initial(64,p,bits));
 }
 for(const type of [0,1,2,3])for(const width of [1,2,4,8,16,...Array.from({length:15},(_,i)=>33+i)]){
  const p=build(5,type,r0+16,width);for(let k=0;k<3;k++)compare(p,64,initial(64,p));
 }
 // Allowlist boundaries, zero/scratch/ACC/flags are never caching sources.
 for(const type of [0,1,2,3])for(const src of [r0,vf0,vf0+32*16,acc,flags,r0+16+1,r0+16+15,r0+31*16+16-widths[type],vf0+31*16+16-widths[type],r0+31*16+17-widths[type]]){
  const p=build(8,type,src);for(const bits of edges)compare(p,64,initial(64,p,bits));
  if([r0,vf0,vf0+32*16,acc,flags].includes(src))assert(p.baseline.code.equals(p.candidate.code),'excluded field changed emitted bytecode');
 }
 // Actual MakeSz has a shared temporary consumer; the full temporary input cone
 // is excluded. No source relative-store cone guarantee is claimed.
 const cone=build(9,3,vf0+16);for(const bits of edges)compare(cone,64,initial(64,cone,bits));
 assert(cone.baseline.code.equals(cone.candidate.code),'MakeSz/shared temp cone changed');
 for(const type of [0,1,2,3]){const toggle=build(0,type,r0+16,0,3);for(const bits of edges)compare(toggle,64,initial(64,toggle,bits));}
 const fullMaskNegative=build(17,0,r0+16,47);for(const bits of edges)compare(fullMaskNegative,64,initial(64,fullMaskNegative,bits));
 const vfzero=build(14,3,vf0+16);for(const bits of edges)compare(vfzero,64,initial(64,vfzero,bits));
 const mixed=build(15,0,r0+16);for(const bits of edges)compare(mixed,64,initial(64,mixed,bits));
 const cap=build(16,0,r0+16);compare(cap,64,initial(64,cap));
 const select=build(10,0,r0+16);for(const bits of edges)compare(select,64,initial(64,select,bits));
 for(const count of [31,32,33,40]){const p=build(13,0,r0+16,count);compare(p,64,initial(64,p));}
 for(const bad of [bytes.length-64-2,0x7fffffff,0x10000000,0xffff0000,0xffffffff]){
  const p=build(12,0,r0+16,bad);compare(p,64,initial(64,p));
 }
 assert.strictEqual(new Set(positives).size,4);assert(traps>=3);assert(calls>0);assert(changed>0);
 const result={knownBaselineEncodingFailures,knownBaselineOracleFailures,kernels,cases,oracles,traps,calls,changed,identical,positiveTypedWidths:[...new Set(positives)],defaultOrDisabledIdentical:negatives.length,layout,rawBitPatterns:edges,fullMemoryCanaries:true,helperStoreObservation:true,performanceClaim:false};
 fs.writeFileSync(__dirname+'/module-metadata.json',JSON.stringify(metadata,null,2)+'\n');
 const corpusBytes=JSON.stringify({schema:1,layout,memoryPages:4,canary:0xa7,kernels:corpusKernels,cases:corpusCases,knownEncodingFailureOffsets:[0xffff0000,0xffffffff],result},null,2)+'\n';
 if(fs.existsSync(__dirname+'/portable-corpus.json'))assert.strictEqual(fs.readFileSync(__dirname+'/portable-corpus.json','utf8'),corpusBytes,'frozen corpus drift');else fs.writeFileSync(__dirname+'/portable-corpus.json',corpusBytes);
 fs.writeFileSync(__dirname+'/result.json' ,JSON.stringify(result,null,2)+'\n');console.log('PASS',JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
