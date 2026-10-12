const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
 const {createBackgroundPause}=await import(pathToFileURL(path.resolve(__dirname,'../deploy/webrcade/retro-dolphin/app/lifecycle.mjs')));
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 let current={paused:false},menu=false,release=null,delay=false;
 const calls=[];
 const lifecycle=createBackgroundPause({getSession:()=>current,
  canPause:s=>s&&!s.paused&&!menu,
  canResume:s=>s===current&&!menu,
  async pause(){calls.push('pause');current.paused=true;if(delay)await new Promise(resolve=>release=resolve);},
  async resume(){calls.push('resume');current.paused=false;},onError:e=>{throw e;}});
 lifecycle.background();lifecycle.foreground();await tick();
 assert.deepEqual(calls,['pause','resume']);
 delay=true;lifecycle.background();lifecycle.foreground();await tick();
 assert.equal(current.paused,true,'return waits for worker pause acknowledgement');
 release();await tick();assert.equal(current.paused,false);
 menu=true;current.paused=true;lifecycle.background();lifecycle.foreground();await tick();
 assert.equal(current.paused,true,'deliberate pause survives return');
 menu=false;current.paused=false;delay=true;lifecycle.background();await tick();
 current={paused:false};lifecycle.reset();lifecycle.foreground();release();await tick();
 assert.equal(calls.filter(x=>x==='resume').length,2,'old session never resumes its replacement');
 console.log('PASS GameCube background/return ownership, delayed worker acknowledgement, manual menu and replaced session');
})().catch(e=>{console.error(e);process.exitCode=1;});
