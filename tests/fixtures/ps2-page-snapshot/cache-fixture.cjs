const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
(async()=>{
 const m=await require(path.join(__dirname,'cache.cjs'))();
 const lifecycle=m._run_fixture();
 const capacity=1024*1024+64,ptr=m._malloc(capacity);
 const bytes=Buffer.alloc(capacity);let cases=0,random=0x6d2b79f5;
 for(let i=0;i<capacity;i++){
  random^=random<<13;random^=random>>>17;random^=random<<5;bytes[i]=random&255;
 }
 m.HEAPU8.set(bytes,ptr);
 // Every page byte and bit participates in the exact unchanged predicate.
 m._assign_snapshot(ptr);
 assert.equal(m._equals_snapshot(ptr),1);cases++;
 for(let offset=0;offset<4096;offset++)for(let bit=0;bit<8;bit++){
  m.HEAPU8[ptr+offset]^=1<<bit;
  assert.equal(m._equals_snapshot(ptr),0,`byte ${offset}, bit ${bit}`);cases++;
  m.HEAPU8[ptr+offset]^=1<<bit;
 }
 for(let alignment=0;alignment<32;alignment++){
  m._assign_snapshot(ptr+alignment);
  assert.equal(m._equals_snapshot(ptr+alignment),1);cases++;
  for(const offset of [0,15,16,31,32,63,64,4095]){
   m.HEAPU8[ptr+alignment+offset]^=128;
   assert.equal(m._equals_snapshot(ptr+alignment),0);cases++;
   m.HEAPU8[ptr+alignment+offset]^=128;
  }
 }
 // A full final page ends exactly at actual Wasm linear memory end.
 const end=m.HEAPU8.length-4096;
 m.HEAPU8.set(bytes.subarray(0,4096),end);
 m._assign_snapshot(end);assert.equal(m._equals_snapshot(end),1);cases++;
 m.HEAPU8[end+4095]^=1;assert.equal(m._equals_snapshot(end),0);cases++;
 // Refresh after change and restoration in both directions.
 m._assign_snapshot(end);assert.equal(m._equals_snapshot(end),1);cases++;
 m.HEAPU8[end+4095]^=1;assert.equal(m._equals_snapshot(end),0);cases++;
 const pages=64,copies=m._create_pages(ptr,pages),benchmark=[];
 // Prewarm both variants and balance ordering after initial JIT tiering.
 for(let i=0;i<6;i++){m._hash_pages(ptr,pages,1000);m._compare_pages(ptr,copies,pages,1000);}
 for(const name of ['hash','copy','copy','hash','copy','hash','hash','copy']){
  const start=performance.now();
  const sum=name==='hash'?m._hash_pages(ptr,pages,1000):m._compare_pages(ptr,copies,pages,1000);
  benchmark.push({name,milliseconds:performance.now()-start,bytes:4096*pages*1000,checksum:sum});
 }
 assert.equal(new Set(benchmark.filter(r=>r.name==='hash').map(r=>r.checksum)).size,1);
 assert(benchmark.filter(r=>r.name==='copy').every(r=>r.checksum===64000));
 m._destroy_pages(copies);m._free(ptr);
 const result={lifecycle,exactPageCases:cases,maxSnapshotBytes:512*4096,benchmark};
 fs.writeFileSync(path.join(__dirname,'page-snapshot-result.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
