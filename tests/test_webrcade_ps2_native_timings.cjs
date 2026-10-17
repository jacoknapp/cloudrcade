const assert=require('node:assert/strict');
(async()=>{
 const {setNativeTimingEnabled,sampleNativeTiming}=await import('../deploy/webrcade/retro-play/app/native-timings.mjs');
 const calls=[];let enabled=false,epoch=0,counter={name:'EE',calls:0,samples:0,microseconds:0};
 const module={setNativeTimingEnabled(value){calls.push(value);if(value!==enabled){epoch+=2;enabled=value;}},nativeCpuTiming(){return {enabled,epoch:epoch|enabled,categories:[{...counter}]};}};
 setNativeTimingEnabled(module,true,true);assert.deepEqual(calls,[false,true]);
 assert.match(sampleNativeTiming(module).line,/collecting/);
 counter={name:'EE',calls:6400,samples:100,microseconds:12000};
 const sample=sampleNativeTiming(module);assert.match(sample.line,/0.12 ms\/sample \(100\/6400 calls\)/);assert.match(sample.details,/not CPU utilization/);
 setNativeTimingEnabled(module,true,true);assert.match(sampleNativeTiming(module).line,/collecting/);
 setNativeTimingEnabled(module,false);assert.match(sampleNativeTiming(module).line,/collecting/);
 assert.match(sampleNativeTiming({}).line,/unavailable/);
 console.log('PASS native timing UI epoch reset, sparse denominator, off and missing-core fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
