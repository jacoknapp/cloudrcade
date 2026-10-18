const assert=require('node:assert/strict'),fs=require('node:fs');
const {performance}=require('node:perf_hooks');
(async()=>{
 const all={candidate:await require('./candidate.cjs')()},rows=[];
 if(fs.existsSync(__dirname+'/baseline.cjs'))all.baseline=await require('./baseline.cjs')();
 const order=all.baseline?['baseline','candidate','candidate','baseline','candidate','baseline','baseline','candidate']:['candidate','candidate'];
 for(const enabled of [false,true])for(const name of order){
  const m=all[name],pointer=m._bodyPointer();m._enable(enabled?1:0);
  const calls=m._calls(),samples=m._samples();
  const direct=m._runDirect(100000,pointer);
  assert.equal(m._runTimed(100000,pointer),direct);
  const start=performance.now(),checksum=m._runTimed(6000000,pointer),milliseconds=performance.now()-start;
  rows.push({name,enabled,milliseconds,checksum,calls:m._calls()-calls,samples:m._samples()-samples});
 }
 for(const enabled of [false,true]){
  const rowsFor=rows.filter(x=>x.enabled===enabled);
  assert.equal(new Set(rowsFor.map(x=>x.checksum)).size,1);
  assert(rowsFor.every(x=>x.calls===(enabled?6100000:0)));
  if(all.baseline)for(let i=0;i<4;i++)assert.equal(rowsFor.filter(x=>x.name==='baseline')[i].samples,rowsFor.filter(x=>x.name==='candidate')[i].samples);
 }
 fs.writeFileSync(__dirname+'/screen-result.json',JSON.stringify(rows,null,2)+'\n');
 console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
