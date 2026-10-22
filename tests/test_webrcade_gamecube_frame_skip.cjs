const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
 const {FrameSkip,frameSkipDivisor}=await import(pathToFileURL(path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app/frame-skip.mjs')));
 for(const value of [null,undefined,0,5,-1,2.5,NaN,'bad'])assert.equal(frameSkipDivisor(value),1);
 const f=new FrameSkip();f.set(4);
 for(const skipped of [false,true,true,false,true])f.complete(skipped);
 assert.deepEqual(f.snapshot(),{divisor:4,requested:4,frames:5,skipped:3},
  'account for authoritative native markers, not an independent host cadence');
 f.set(1);f.complete(true);f.complete(false);
 assert.equal(f.snapshot().skipped,4,'queued skipped native frames stay omitted after switching Off');
 assert.equal(f.snapshot().frames,7);
 console.log('PASS frame skip values and authoritative native presentation accounting');
})().catch(error=>{console.error(error);process.exitCode=1;});
