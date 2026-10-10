const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../deploy/webrcade/touch/cloud/bridge.js'), 'utf8');
const storage = new Map(), backups = new Map(), remote = new Map();
const copy = files => files && files.map(f => ({name:f.name,content:new Uint8Array(f.content)}));
let offline = false, beforeFetch = null, revision = 0, loseAck = false, afterGet = null;
const errors = [], writes = [];
function connect(uid) { storage.set('wrcad.nextcloud.connection.v1', JSON.stringify({uid,login:uid,password:'fake'})); }
connect('alice');
function fixture(server='https://nextcloud.test') {
 const win = {top:{},addEventListener(){},WrcadCloudConfig:{storagePrefix:'wrcad',enabled:true,autoRedirect:false,accessAllowed:true,server,legacyServer:'https://nextcloud.test'}};
 const fetch = async (url, options = {}) => {
  if (beforeFetch) { const fn = beforeFetch;beforeFetch = null;await fn(); }
  const query = new URL(url, 'https://games.test').searchParams;
  if (query.get('action') === 'status') return Response.json({csrf:'test'});
  if (offline) return Response.json({error:'offline'},{status:502});
  const uid = decodeURIComponent(options.headers['X-Nextcloud-User']), file = query.get('path');
  const key = JSON.stringify([uid,file]), old = remote.get(key), method = options.method;
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
 vm.runInNewContext(source,{window:win,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:require('node:crypto').webcrypto,fetch,Blob,TextEncoder,TextDecoder,Uint8Array,btoa,unescape,encodeURIComponent,console});
 class Saves {
  constructor() {this.errorCallback = e=>errors.push(e);}
  getZipFileName(p) { return p.endsWith('.zip') ? p : p+'.zip'; }
  async loadLocal(p) {return copy(backups.get(this.getZipFileName(p)));}
  async saveLocal(p,files) {backups.set(this.getZipFileName(p),copy(files));}
  async createZip(files) {return new Blob([JSON.stringify(files.map(f=>({name:f.name,content:Array.from(f.content)})))]);}
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
 console.log('PASS same-UID server isolation, safe legacy migration and in-flight server changes');
 console.log('PASS lost acknowledgements, newer offline progress, restart recovery, legacy pending records and competing-write protection');
 console.log('PASS dirty recovery across restart, conflicts preserve both copies, account switching, fresh-account isolation, in-flight guards and legacy-owner migration');
})().catch(e=>{console.error(e);process.exitCode=1;});
