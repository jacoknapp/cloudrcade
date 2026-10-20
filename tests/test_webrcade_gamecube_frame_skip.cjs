const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
 const {FrameSkip,frameSkipDivisor}=await import(pathToFileURL(path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app/frame-skip.mjs')));
 for(const value of [null,undefined,0,5,-1,2.5,NaN,'bad'])assert.equal(frameSkipDivisor(value),1);
 for(const divisor of [1,2,3,4]){
  const f=new FrameSkip();f.set(divisor);
  for(let i=0;i<24;i++){
   assert.equal(f.skip(),i%divisor!==0);
   assert.equal(f.skip(),i%divisor!==0,'multiple passes do not advance the frame');
   assert.equal(f.complete(),i%divisor!==0);
  }
  assert.equal(f.snapshot().frames-f.snapshot().skipped,24/divisor);
 }
 const f=new FrameSkip();f.set(4);assert.equal(f.skip(),false);f.complete();
 assert.equal(f.skip(),true);f.set(1);
 assert.equal(f.skip(),true,'changing to Off cannot expose half a skipped frame');
 f.complete();assert.equal(f.skip(),false);f.complete();assert.equal(f.skip(),false);
 f.set(3);f.complete();assert.equal(f.skip(),false,'new setting begins with a full displayed frame');
 console.log('PASS frame skip cadence, default Off, bounded values and changes at complete-frame boundaries');
})().catch(error=>{console.error(error);process.exitCode=1;});
