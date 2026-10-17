const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
(async()=>{
 const mods=await Promise.all(['scalar','simd'].map(n=>require(path.join(__dirname,n+'.cjs'))()));
 const [scalar,simd]=mods;
 const backends=JSON.parse(fs.readFileSync(path.join(__dirname,'backends.json')));
 assert.deepEqual(backends,['XXH_SCALAR','XXH_NEON']);
 const capacity=1024*1024+128;
 const ptr=mods.map(m=>m._malloc(capacity));
 const out=mods.map(m=>m._malloc(16));
 const values=m=>Buffer.from(m.HEAPU8.subarray(out[mods.indexOf(m)],out[mods.indexOf(m)]+16));
 const lengths=[...Array(258).keys(),511,512,513,1023,1024,1025,2047,2048,2049,4095,4096,4097,8191,8192,8193,16383,16384,16385,65535,65536,65537,1048576];
 const bytes=Buffer.alloc(capacity);let cases=0;
 function compare(addresses,length,label){
  mods.forEach((m,i)=>m._hash(addresses[i],length,out[i]));
  assert.deepEqual(values(scalar),values(simd),label);cases++;
 }
 for(let pattern=0;pattern<4;pattern++){
  let random=0x6d2b79f5;
  for(let i=0;i<capacity;i++){
   random^=random<<13;random^=random>>>17;random^=random<<5;
   bytes[i]=pattern===0?0:pattern===1?255:pattern===2?i&255:random&255;
  }
  mods.forEach((m,i)=>m.HEAPU8.set(bytes,ptr[i]));
  for(const length of lengths)for(let alignment=0;alignment<32;alignment++)
   compare(ptr.map(p=>p+alignment),length,`${pattern}/${length}/${alignment}`);
  // A real linear-memory end makes vector overreads trap, even for zero length.
  for(const length of lengths){
   const ends=mods.map(m=>m.HEAPU8.length-length);
   mods.forEach((m,i)=>m.HEAPU8.set(bytes.subarray(0,length),ends[i]));
   compare(ends,length,`memory-end/${pattern}/${length}`);
  }
 }
 const benchmark=[];
 for(const name of ['scalar','simd','simd','scalar','simd','scalar','scalar','simd']){
  const i=name==='scalar'?0:1,m=mods[i];
  m._hash_pages(ptr[i],64,50,out[i]);
  const start=performance.now();m._hash_pages(ptr[i],64,1000,out[i]);
  benchmark.push({name,milliseconds:performance.now()-start,bytes:4096*64*1000,checksum:values(m).toString('hex')});
 }
 assert.equal(new Set(benchmark.map(x=>x.checksum)).size,1);
 const result={cases,backends,benchmark};
 fs.writeFileSync(path.join(__dirname,'hash-fixture-result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
