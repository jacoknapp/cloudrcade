const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async()=>{
  const {configureGameCube} = await import(pathToFileURL(path.resolve(__dirname,
    '../deploy/webrcade/retro-dolphin/app/core-config.mjs')));
  const files = new Map([['/dolphin-user/GC/USA/Card A/game.gci', 'saved card']]);
  const fs = {mkdirTree(){}, writeFile(name, contents){files.set(name, contents);}};
  for (const id of ['GM4E01','GMSE01']) {
    assert.equal(configureGameCube(fs,id),true);
    assert.equal(files.get(`/dolphin-user/GameSettings/${id}.ini`), '[Core]\nSyncOnSkipIdle = True\n');
  }
  const before = [...files];
  for (const id of ['', null, '../bad', 'G/../../bad', 'GM4E01\n']) {
    assert.equal(configureGameCube(fs,id),false);
    assert.deepEqual([...files],before,'invalid metadata cannot write elsewhere in the core FS');
  }
  assert.equal(files.get('/dolphin-user/GC/USA/Card A/game.gci'),'saved card');
  console.log('PASS GameCube per-disc GPU synchronization and bounded metadata paths; cards preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
