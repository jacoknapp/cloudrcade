const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async()=>{
  const {waitForStateLoad} = await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/state-load.mjs')));
  let time=0, generation=7, filePresent=true;
  await waitForStateLoad(()=>generation,7,{now:()=>time,sleep:async ms=>{
    time+=ms;assert(filePresent,'native input cannot be removed while the queued load is pending');
    if(time>=2500)generation++;
  }});
  filePresent=false;
  assert.equal(time,2500,'a slow load completes after the old fixed 1.2 second delay');
  time=0;
  await assert.rejects(waitForStateLoad(()=>8,8,{timeoutMs:200,now:()=>time,sleep:async ms=>{time+=ms;}}),/restore timed out/);
  assert.equal(time,200,'a stuck native load cannot hold the save queue forever');
  await waitForStateLoad(()=>9,8,{sleep:async()=>assert.fail('completed load needs no arbitrary delay')});
  console.log('PASS GameCube waits for native state-load completion and bounds stalled restores');
})().catch(error=>{console.error(error);process.exitCode=1;});
