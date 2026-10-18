const fs=require('fs'),path=require('path'),assert=require('assert');
const {performance}=require('perf_hooks');
const dir=__dirname;
(async()=>{
 const generators={};for(const variant of ['baseline','candidate'])generators[variant]=await require('./'+variant+'.cjs')();
 const table=new WebAssembly.Table({initial:1,element:'anyfunc'}),memory=new WebAssembly.Memory({initial:2,maximum:32768,shared:true});
 const bytes=new Uint8Array(memory.buffer),view=new DataView(memory.buffer);
 function build(variant,kind,count=1){const g=generators[variant],ptr=g._generate(kind,count),code=Buffer.from(g.HEAPU8.subarray(ptr,ptr+g._generatedSize()));
  if(kind===0&&count===1)fs.writeFileSync(path.join(dir,variant+'-generated.wasm'),code);
  return new WebAssembly.Instance(new WebAssembly.Module(code),{env:{memory,fctTable:table}}).exports.codeGenFunc;
 }
 const kernels=Array.from({length:4},(_,kind)=>({baseline:build('baseline',kind),candidate:build('candidate',kind)}));
 const base=256;let cases=0;
 function check(words){
  for(let kind=0;kind<4;kind++){
   bytes.fill(0xA5,base,base+64);const src=base+(kind===3?3:0),dst=base+(kind===2?0:kind===3?23:16);
   for(let lane=0;lane<4;lane++)view.setUint32(src+lane*4,words[lane],true);
   const input=Buffer.from(bytes.subarray(base,base+64)),expected=Buffer.from(input);let flags=0;
   for(let lane=0;lane<4;lane++){
    const w=(words[lane]^(kind===1?0x80808080:0))>>>0;
    if((w&0x7FFFFFFF)===0)flags|=1<<(3-lane);
    if(w>>>31)flags|=1<<(7-lane);
   }
   expected.writeUInt32LE(flags,dst-base);
   kernels[kind].baseline(base);const old=Buffer.from(bytes.subarray(base,base+64));
   bytes.set(input,base);kernels[kind].candidate(base);const actual=Buffer.from(bytes.subarray(base,base+64));
   assert.deepStrictEqual(actual,old,'differential kind='+kind+' words='+words.map(x=>(x>>>0).toString(16)));
   assert.deepStrictEqual(actual,expected,'oracle kind='+kind);
   cases++;
  }
 }
 // Every independent lane sign/zero combination, including negative zero.
 for(let signs=0;signs<16;signs++)for(let zeros=0;zeros<16;zeros++)check(Array.from({length:4},(_,i)=>(((signs>>>i)&1?0x80000000:0)|((zeros>>>i)&1?0:0x3F800000))>>>0));
 const special=[0,0x80000000,1,0x80000001,0x007FFFFF,0x807FFFFF,0x00800000,0x80800000,0x7F7FFFFF,0xFF7FFFFF,0x7F800000,0xFF800000,0x7F800001,0xFF800001,0x7FC00000,0xFFC00000,0x7FFFFFFF,0xFFFFFFFF,0x01010101,0x80808080,0xA5A5A5A5,0x5A5A5A5A];
 for(const a of special)for(const b of special)for(let r=0;r<4;r++)check([a,b,special[(r*5)%special.length],special[(r*7+3)%special.length]]);
 // Exhaust all high-half patterns in every lane; low bytes oppose/mix the sign.
 for(let high=0;high<65536;high++)check([((high<<16)|(~high&65535))>>>0,((high<<16)|high)>>>0,((high<<16)|0x8000)>>>0,((high<<16)|0)>>>0]);
 // All 256 raw byte values in each byte position, independent lane rotations.
 for(let b=0;b<256;b++)for(let shift=0;shift<32;shift+=8)check([b<<shift,(255-b)<<shift,(b*0x01010101)>>>0,((255-b)*0x01010101)>>>0]);
 let rng=0x7A37611;function rand(){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return rng>>>0;}
 for(let i=0;i<100000;i++)check([rand(),rand(),rand(),rand()]);
 // Exact upper linear-memory boundary, aligned/unaligned input+result and alias.
 for(let kind=0;kind<4;kind++){
  const ctx=bytes.length-(kind===2?16:kind===3?27:20);bytes.fill(0xA5,ctx);const src=ctx+(kind===3?3:0);for(let i=0;i<4;i++)view.setUint32(src+i*4,special[i+10],true);
  const input=Buffer.from(bytes.subarray(ctx));kernels[kind].baseline(ctx);const expected=Buffer.from(bytes.subarray(ctx));bytes.set(input,ctx);kernels[kind].candidate(ctx);assert.deepStrictEqual(Buffer.from(bytes.subarray(ctx)),expected);cases++;
 }
 // Balanced warmed screen of the actual generated sequence; not game FPS.
 const screens={baseline:build('baseline',0,32),candidate:build('candidate',0,32)};
 for(let i=0;i<32;i++)for(let j=0;j<4;j++)view.setUint32(base+i*64+j*4,special[(i+j)%special.length],true);
 const iterations=300000;
 for(let i=0;i<20000;i++){screens.baseline(base);screens.candidate(base);}
 const samples={baseline:[],candidate:[]};for(const variant of ['baseline','candidate','candidate','baseline','baseline','candidate','candidate','baseline']){
  const start=performance.now();for(let i=0;i<iterations;i++)screens[variant](base);samples[variant].push(performance.now()-start);
 }
 const result={cases,kindCount:4,fullContextBytes:64,screenOperationsPerSample:iterations*32,screenMs:samples,gamePerformanceClaim:false};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS actual CodeGen MakeSz raw-bit/alias/bounds differential',JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});
