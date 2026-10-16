const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../deploy/webrcade/touch/cloud/bridge.js'), 'utf8');
const storage = new Map(), backups = new Map(), remote = new Map();
const copy = files => files && files.map(f => ({name:f.name,content:f.content instanceof Blob?f.content:new Uint8Array(f.content)}));
let offline = false, beforeFetch = null, revision = 0, loseAck = false, afterGet = null, hangPut = false;
let csrfToken='test', csrfRejections=0, rotateAfterStatus=false, denyPut=false, invalidStatus=false, putRequests=0;
const errors = [], writes = [];
const deadlines=[],signalDeadlines=new WeakMap();
function connect(uid) { storage.set('wrcad.nextcloud.connection.v1', JSON.stringify({uid,login:uid,password:'fake'})); }
connect('alice');
function fixture(server='https://nextcloud.test') {
 const win = {top:{},addEventListener(){},WrcadCloudConfig:{storagePrefix:'wrcad',enabled:true,autoRedirect:false,accessAllowed:true,server,legacyServer:'https://nextcloud.test'}};
 const fetch = async (url, options = {}) => {
  if (beforeFetch) { const fn = beforeFetch;beforeFetch = null;await fn(); }
  const query = new URL(url, 'https://games.test').searchParams;
  deadlines.push({method:options.method||'GET',action:query.get('action'),timeout:signalDeadlines.get(options.signal)});
  if (query.get('action') === 'status') {
   const response=Response.json(invalidStatus?{}:{csrf:csrfToken});
   if(rotateAfterStatus){rotateAfterStatus=false;csrfToken+='-rotated';}
   return response;
  }
  if(options.method==='PUT')putRequests++;
  if(options.headers['X-CSRF-Token']!==csrfToken){csrfRejections++;return Response.json({code:'csrf_invalid',error:'Refresh the page and try again.'},{status:403});}
  if(options.method==='PUT'&&denyPut)return Response.json({code:'access_denied',error:'Cloud permission denied for this connection.'},{status:403});
  if (offline) return Response.json({error:'offline'},{status:502});
  const uid = decodeURIComponent(options.headers['X-Nextcloud-User']), file = query.get('path');
  const key = JSON.stringify([uid,file]), old = remote.get(key), method = options.method;
  if (method === 'PUT' && hangPut) return new Promise((_,reject)=>{options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
  if (method === 'PUT') {
   if ((options.headers['If-None-Match'] === '*' && old) || (options.headers['If-Match'] && options.headers['If-Match'] !== old?.etag)) return Response.json({error:'conflict'},{status:409});
   const next = {body:new Blob([options.body]),etag:`"${++revision}"`};remote.set(key,next);writes.push({uid,file});
   if (loseAck) { loseAck = false; throw new Error('response lost after remote commit'); }
   return new Response('',{headers:{ETag:next.etag}});
  }
  if (!old) return Response.json({error:'missing'},{status:404});
  if (method === 'GET' && afterGet) { const fn=afterGet;afterGet=null;fn(); }
  return new Response(method === 'HEAD' ? null : old.body,{headers:{ETag:old.etag}});
 };
 vm.runInNewContext(source,{window:win,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:require('node:crypto').webcrypto,fetch,Blob,TextEncoder,TextDecoder,Uint8Array,AbortSignal:{timeout(ms){const signal=AbortSignal.timeout(ms);signalDeadlines.set(signal,ms);return signal;}},btoa,unescape,encodeURIComponent,console});
 class Saves {
  constructor() {this.errorCallback = e=>errors.push(e);}
  getZipFileName(p) { return p.endsWith('.zip') ? p : p+'.zip'; }
  async loadLocal(p) {return copy(backups.get(this.getZipFileName(p)));}
  async saveLocal(p,files) {backups.set(this.getZipFileName(p),copy(files));}
  async createZip(files) {return new Blob([JSON.stringify(await Promise.all(files.map(async f=>({name:f.name,content:Array.from(f.content instanceof Blob?new Uint8Array(await f.content.arrayBuffer()):f.content)}))))]);}
  async getFiles(blob) {return JSON.parse(await blob.text()).map(f=>({...f,content:new Uint8Array(f.content)}));}
  async checkFilesChanged() {return true;}
  async getStateSlots() {return [];}
  async delete(p) {backups.delete(this.getZipFileName(p));}
 }
 // Native cloud disabled must never disable an existing Nextcloud connection.
 win.WrcadCloud.install({settings:{isCloudStorageEnabled:()=>false,getDbToken:()=>null},saves:Saves});
 return {manager:new Saves(),create:()=>new Saves(),cloud:win.WrcadCloud};
}
const files = n => [{name:'sav',content:new Uint8Array([n])}];
const value = f => f?.find(f=>f.name==='sav')?.content[0];
const savePath = '/wrc/test/sav';
(async()=>{
 const bounded=fixture();bounded.manager.cloudRequestTimeoutMs=60000;bounded.manager.cloudUploadTimeoutMs=180000;
 const startDeadlines=deadlines.length;
 assert.equal(await bounded.manager.save('/large-state-deadline',files(1)),true);
 assert.equal(await bounded.manager.saveCloud('/large-state-head',files(2)),true);
 await bounded.manager.loadCloud('/large-state-deadline');
 const observed=deadlines.slice(startDeadlines);
 assert(observed.some(v=>v.method==='PUT'&&v.timeout===180000),'large uploads can finish server-side scanning');
 assert(observed.some(v=>v.method==='HEAD'&&v.timeout===60000),'metadata reads retain their deadline');
 assert(observed.some(v=>v.method==='GET'&&v.action==='file'&&v.timeout===60000),'downloads retain their deadline');
 // Renew an expired PHP session before transmitting a save body. A session
 // changed during the upload may still retry once, preserving its revision.
 const session=fixture();await session.manager.load('/session-prime');
 csrfToken='renewed-session';let rejects=csrfRejections;
 assert.equal(await session.manager.save('/expired-session',files(1)),true);
 assert.equal(csrfRejections,rejects,'expired session refreshed before PUT');
 rotateAfterStatus=true;
 assert.equal(await session.manager.save('/session-race',files(2)),true);
 assert.equal(csrfRejections,rejects+1,'one bounded retry repairs a session race');
 denyPut=true;let puts=putRequests;
 assert.equal(await session.manager.save('/denied-session',files(3)),false);
 assert.equal(putRequests,puts+1,'permission denial does not resend the body');
 assert.match(errors.at(-1),/permission denied/);
 assert.equal(value(await session.manager.loadLocal('/denied-session')),3);
 denyPut=false;assert.equal(value(await fixture().manager.load('/denied-session')),3);
 invalidStatus=true;puts=putRequests;
 assert.equal(await session.manager.save('/invalid-session',files(4)),false);
 assert.equal(putRequests,puts,'invalid bootstrap cannot upload a save');
 assert.equal(value(await session.manager.loadLocal('/invalid-session')),4);
 invalidStatus=false;
 console.log('PASS fresh-session preflight, bounded CSRF retry, actionable denial, failed bootstrap and preserved local recovery');
 let a=fixture();
 assert.equal(await a.manager.save(savePath,files(1)),true);
 offline=true;assert.equal(await a.manager.save(savePath,files(2)),false);
 assert.equal(value(await a.manager.loadLocal(savePath)),2);
 // A new JS context shares the browser disk but has no in-memory ETags.
 a=fixture();offline=false;
 assert.equal(value(await a.manager.load(savePath)),2);
 assert.equal(value(await a.manager.loadCloud(savePath)),2);
 assert.equal(value(await a.manager.loadLocal(savePath)),2);
 // Another device advances the remote while this device has pending progress.
 offline=true;await a.manager.save(savePath,files(3));offline=false;
 const key=JSON.stringify(['alice',savePath+'.zip']);
 remote.set(key,{body:await a.manager.createZip(files(9)),etag:'"other-device"'});
 a=fixture();assert.equal(value(await a.manager.load(savePath)),3);
 assert.equal(value(await a.manager.loadLocal(savePath)),3);
 assert.equal(value(await a.manager.loadCloud(savePath)),9);
 // A conflict must not replace the pending save's original baseline on retry.
 assert.equal(await a.manager.save(savePath,files(4)),false);
 assert.equal(value(await a.manager.loadCloud(savePath)),9);
 assert.equal(value(await a.manager.loadLocal(savePath)),4);
 // Existing remote for Bob cannot be overwritten by Alice's open game.
 connect('bob');const bob=fixture();assert.equal(await bob.manager.save(savePath,files(7)),true);
 const count=writes.length;
 assert.equal(await a.manager.save(savePath,files(5)),false);
 assert.equal(writes.length,count);
 assert.equal(value(await bob.manager.load(savePath)),7);
 await assert.rejects(a.manager.saveCloud(savePath,files(6)),/account changed/i);
 // 3DS background reports must retain the original bridged manager identity.
 const reportSource=fs.readFileSync(path.join(__dirname,
  '../deploy/webrcade/retro-azahar/app/src/emulator/shaderfailures.js'),'utf8');
 const {quietCloudManager}=await import('data:text/javascript;base64,'+Buffer.from(reportSource).toString('base64'));
 globalThis.window={WrcadCloud:a.cloud};
 try {
  const quiet=quietCloudManager(a.manager);
  assert.equal(quiet,a.manager,'bridged cloud calls keep their account owner');
  assert.equal(await quiet.isCloudEnabled(),false);
  await assert.rejects(quiet.saveCloud('/3ds-report-test',files(6)),/account changed/i);
  assert.equal(remote.has(JSON.stringify(['bob','/3ds-report-test.zip'])),false);
 } finally { delete globalThis.window; }
 // A genuinely empty third account cannot import another account's local ZIP.
 connect('charlie');const c=fixture();assert.equal(await c.manager.load(savePath),null);
 assert.equal(writes.filter(w=>w.uid==='charlie').length,0);
 // Account changes during auth bootstrap do not retarget a pending upload.
 connect('alice');const inflight=fixture();
 beforeFetch=async()=>connect('bob');
 assert.equal(await inflight.manager.save('/new/sav',files(8)),false);
 assert.equal(remote.has(JSON.stringify(['bob','/new/sav.zip'])),false);
 // Unscoped pre-upgrade backups migrate only to the initially recorded owner.
 backups.set('/legacy/sav.zip',files(11));
 assert.equal(await c.manager.loadLocal('/legacy/sav'),null);
 connect('alice');const migrated=fixture();assert.equal(value(await migrated.manager.loadLocal('/legacy/sav')),11);
 assert.equal(value(backups.get('/legacy/sav.zip')),11,'original backup retained');
 // Lost acknowledgements recover across restart and newer offline progress.
 for (const initial of [false,true]) {
  const p='/lost-ack/'+initial, key=JSON.stringify(['alice',p+'.zip']);
  let client=fixture();
  if (initial) assert.equal(await client.manager.save(p,files(1)),true);
  loseAck=true;assert.equal(await client.manager.save(p,files(2)),false);
  offline=true;assert.equal(await client.manager.save(p,files(3)),false);offline=false;
  client=fixture();assert.equal(value(await client.manager.load(p)),3);
  assert.equal(value(await client.manager.loadCloud(p)),3);
  assert.equal(await client.manager.save(p,files(4)),true);
  // A real competing write after the uncertain upload must still be kept.
  loseAck=true;assert.equal(await client.manager.save(p,files(5)),false);
  remote.set(key,{body:await client.manager.createZip(files(99)),etag:'"competing"'});
  client=fixture();assert.equal(value(await client.manager.load(p)),5);
  assert.equal(await client.manager.save(p,files(6)),false);
  assert.equal(value(await client.manager.loadCloud(p)),99);
  assert.equal(value(await client.manager.loadLocal(p)),6);
 }
 // An acknowledgement lost with no further edits needs no redundant PUT.
 let ack=fixture();loseAck=true;assert.equal(await ack.manager.save('/ack-only',files(10)),false);
 const before=writes.length;
 ack=fixture();assert.equal(value(await ack.manager.load('/ack-only')),10);
 assert.equal(writes.length,before);
 assert.equal(await ack.manager.save('/ack-only',files(11)),true);
 // Pre-upgrade pending records have no fingerprint; identical remote content
 // may be acknowledged, while existing conflict tests still protect differences.
 loseAck=true;assert.equal(await ack.manager.save('/old-ack',files(12)),false);
 const oldKey='/wrcad-local-v3/'+encodeURIComponent(JSON.stringify(['https://nextcloud.test','alice']))+'/old-ack.zip';
 const meta=backups.get(oldKey).find(f=>f.name==='wrcad-local-sync.json');
 const sync=JSON.parse(new TextDecoder().decode(meta.content));delete sync.attempt;
 meta.content=new TextEncoder().encode(JSON.stringify(sync));
 ack=fixture();assert.equal(value(await ack.manager.load('/old-ack')),12);
 assert.equal(await ack.manager.save('/old-ack',files(13)),true);
 // ZIP member order/timestamps/info metadata are not gameplay data.
 const rtc=n=>({name:'clock.rtc',content:new Uint8Array([n])});
 loseAck=true;assert.equal(await ack.manager.save('/rtc-ack',[...files(14),rtc(1)]),false);
 const rtcKey=JSON.stringify(['alice','/rtc-ack.zip']);
 remote.set(rtcKey,{body:await ack.manager.createZip([rtc(1),...files(14),{name:'info.txt',content:new Uint8Array([88])}]),etag:'"repacked"'});
 ack=fixture();await ack.manager.load('/rtc-ack');
 assert.equal(await ack.manager.save('/rtc-ack',[...files(15),rtc(2)]),true);
 loseAck=true;assert.equal(await ack.manager.save('/rtc-ack',[...files(16),rtc(3)]),false);
 remote.set(rtcKey,{body:await ack.manager.createZip([...files(16),rtc(99)]),etag:'"other-rtc"'});
 ack=fixture();await ack.manager.load('/rtc-ack');
 assert.equal(await ack.manager.save('/rtc-ack',[...files(17),rtc(4)]),false,'different RTC sidecar is a real conflict');
 // Another device can write between reconciliation GET and conditional PUT.
 loseAck=true;assert.equal(await ack.manager.save('/race-ack',files(18)),false);
 const raceKey=JSON.stringify(['alice','/race-ack.zip']);
 const competing={body:await ack.manager.createZip(files(99)),etag:'"racing"'};
 afterGet=()=>remote.set(raceKey,competing);
 assert.equal(await ack.manager.save('/race-ack',files(19)),false);
 assert.equal(remote.get(raceKey),competing);
 assert.equal(value(await ack.manager.loadLocal('/race-ack')),19);
 // A second server with the same UID cannot inherit either scoped or legacy backups.
 connect('alice');const originalServer=fixture();await originalServer.manager.saveLocal('/server-private',files(33));
 backups.set('/wrcad-local-v2/'+encodeURIComponent(JSON.stringify('alice'))+'/old-private.zip',files(44));
 assert.equal(value(await originalServer.manager.loadLocal('/old-private')),44,'legacy v2 claimed only by original server');
 storage.set('wrcad.nextcloud.connection.v1',JSON.stringify({uid:'alice',login:'alice',password:'other-fake',server:'https://another.test'}));
 const otherServer=fixture('https://another.test');assert.equal(await otherServer.manager.loadLocal('/server-private'),null);assert.equal(await otherServer.manager.loadLocal('/old-private'),null);
 const countBefore=writes.length;assert.equal(await originalServer.manager.save('/server-private',files(55)),false);assert.equal(writes.length,countBefore);
 // Actual GameCube wrapper + the shipped shared bridge, isolated fake account.
 connect('gamecube-fixture');const gcClient=fixture();
 const {GameCubeSaves}=await import('../deploy/webrcade/retro-dolphin/app/saves.mjs');
 const gc=new GameCubeSaves('Sunshine save test',{});
 gc.manager=gcClient.manager;gc.manager.cloudRequestTimeoutMs=30;
 gc.cardPath='gamecube/GMSE01/cards';gc.statePrefix='gamecube/GMSE01/states/test/';
 let cardVersion=1,exports=0,seen='';
 gc.manager.checkFilesChanged=async files=>{const next=files[0].content[0];const dirty=next!==seen;seen=next;return dirty;};
 const cardAdapter={async request(type){assert.equal(type,'exportCards');exports++;return {files:[{name:'USA/Card A/test.gci',content:new Uint8Array([cardVersion])}]};}};
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 let releaseUpload;beforeFetch=()=>new Promise(resolve=>releaseUpload=resolve);
 const pendingCards=gc.cards(cardAdapter);
 while(!releaseUpload)await tick();
 assert.equal(gc.syncing,true);assert.match(gc.syncStatus,/Uploading memory cards/);
 assert.equal(gc.cards(cardAdapter),pendingCards,'autosaves coalesce while one upload is outstanding');
 releaseUpload();await pendingCards;
 assert.equal(exports,1);assert.equal(gc.syncing,false);assert.match(gc.syncStatus,/uploaded to cloud/);
 assert.equal((await gcClient.manager.loadCloud(gc.cardPath))[0].content[0],1);
 assert.equal(remote.has(JSON.stringify(['gamecube-fixture',gc.statePrefix+'1.zip'])),false,'Menu card flush never creates a state');
 await gc.cards(cardAdapter);assert.equal(exports,2,'Menu rechecks native cards for new in-game progress');
 assert.equal(writes.filter(w=>w.uid==='gamecube-fixture').length,1,'unchanged successful cards do not reupload');
 const stateAdapter={async saveStateFile(){return {saved:true,bytes:new Uint8Array([7,8,9])};}};
 await gc.saveState(stateAdapter,2);
 const remoteState=await gcClient.manager.loadCloud(gc.statePrefix+2);
 assert.deepEqual(Array.from(remoteState.find(f=>f.name==='state').content),[7,8,9]);
 assert(remoteState.some(f=>f.name==='meta.json'));assert.match(gc.syncStatus,/State uploaded/);
 offline=true;cardVersion=2;await gc.cards(cardAdapter);
 assert.equal(gc.syncing,false);assert.equal(gc.cardsNeedSync,true);assert.match(gc.syncStatus,/cloud upload needs attention/);
 assert.equal((await gcClient.manager.loadLocal(gc.cardPath))[0].content[0],2);
 offline=false;await gc.cards(cardAdapter);
 assert.equal((await gcClient.manager.loadCloud(gc.cardPath))[0].content[0],2);
 // A hung upload has an opt-in deadline, keeps local recovery, and releases
 // the GameCube save queue; unchanged pending progress is retryable.
 hangPut=true;cardVersion=3;
 const keepNodeAlive=setTimeout(()=>{},1000);
 try { await gc.cards(cardAdapter); } finally { clearTimeout(keepNodeAlive);hangPut=false; }
 assert.equal(gc.syncing,false);assert.equal(gc.cardsNeedSync,true);
 assert.equal((await gcClient.manager.loadLocal(gc.cardPath))[0].content[0],3);
 await gc.cards(cardAdapter);assert.equal(gc.cardsNeedSync,false);
 assert.equal((await gcClient.manager.loadCloud(gc.cardPath))[0].content[0],3);
 // Opening Menu during an older upload includes subsequent in-game changes.
 cardVersion=4;releaseUpload=null;beforeFetch=()=>new Promise(resolve=>releaseUpload=resolve);
 const older=gc.cards(cardAdapter);while(!releaseUpload)await tick();
 cardVersion=5;const menuFlush=gc.cards(cardAdapter,{refresh:true});assert.equal(menuFlush,older);
 releaseUpload();await menuFlush;
 assert.equal((await gcClient.manager.loadCloud(gc.cardPath))[0].content[0],5);
 gc.manager.gameSavesDisabled=true;
 await assert.rejects(gc.saveState(stateAdapter,1),/disabled/);
 assert.equal(remote.has(JSON.stringify(['gamecube-fixture',gc.statePrefix+'1.zip'])),false);
 const {Ps2Saves}=await import('../deploy/webrcade/retro-play/app/saves.mjs');
 const ps2=new Ps2Saves(null,{},'fixture',()=>{}),ps2Client=fixture();ps2.manager=ps2Client.manager;ps2.states='ps2/fixture/states/fixture/';
 ps2.manager.errorCallback=text=>{ps2.lastCloudError=text;ps2.report(text);};
 denyPut=true;
 assert.equal(await ps2.save(1,new Uint8Array([7,8,9]),null),false);
 assert.match(ps2.status,/saved locally; Cloud permission denied/);assert.equal(ps2.busy,false);
 assert.deepEqual(Array.from(await ps2.load(1)),[7,8,9]);
 denyPut=false;assert.equal(await ps2.save(1,new Uint8Array([10,11,12]),null),true);
 assert.match(ps2.status,/uploaded to cloud/);assert(!ps2.status.includes('denied'),'successful retry clears stale errors');
 console.log('PASS GameCube Menu card upload, explicit state bytes, uploading status/coalescing, offline/timeout recovery and disabled-save guard through the shared bridge');
 console.log('PASS same-UID server isolation, safe legacy migration and in-flight server changes');
 console.log('PASS lost acknowledgements, newer offline progress, restart recovery, legacy pending records and competing-write protection');
 console.log('PASS dirty recovery across restart, conflicts preserve both copies, account switching, fresh-account isolation, in-flight guards and legacy-owner migration');
})().catch(e=>{console.error(e);process.exitCode=1;});
