/* Production Dropbox transport and shared SaveManager against isolated API doubles. */
const assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../deploy/webrcade/touch/cloud');
const source = name => fs.readFileSync(path.join(root, name + '.js'), 'utf8');
const prefix = 'test', key = prefix + '.dropbox.connection.v1', flowKey = key + '.flow';
const disk = new Map(), session = new Map(), backups = new Map(), remote = new Map();
let revision = 0, refreshes = 0, offline = false, loseAck = false, afterGet = null, onToken = null, invalidAccess = false, failAccount = false;
const writes = [], requests = [];
const storage = map => ({getItem:k=>map.get(k) ?? null, setItem:(k,v)=>map.set(k,String(v)), removeItem:k=>map.delete(k)});
const connection = uid => ({uid, name:uid, appKey:'fixture-app', refreshToken:'refresh-' + uid, accessToken:'access-' + uid, expires:Date.now() + 3600000});
function connect(uid) { disk.set(key, JSON.stringify(connection(uid))); disk.set(prefix + '.cloud.provider.v1', 'dropbox'); }
const failure = (error_summary, status = 409) => Response.json({error_summary}, {status});
async function fetch(url, options = {}) {
 const parsed = new URL(url); requests.push(parsed.href);
 assert(['https://api.dropboxapi.com','https://content.dropboxapi.com'].includes(parsed.origin), 'tokens only sent to fixed Dropbox origins');
 assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
 if (offline) throw new Error('Offline');
 if (parsed.pathname === '/oauth2/token') {
  const args = new URLSearchParams(options.body); refreshes++;
  assert.equal(args.get('client_id'),'fixture-app'); assert(!args.has('client_secret'));
  if (onToken) { const fn = onToken; onToken = null; await fn(); }
  const uid = args.get('refresh_token')?.replace('refresh-','') || 'alice';
  return Response.json({access_token:'access-' + uid, refresh_token:args.get('grant_type') === 'authorization_code' ? 'refresh-' + uid : undefined, account_id:uid, expires_in:14400});
 }
 const token = options.headers.Authorization.replace('Bearer access-', '');
 if (invalidAccess) { invalidAccess = false; return failure('expired_access_token',401); }
 const route = parsed.pathname.replace('/2/','');
 if (route === 'users/get_current_account') {
  if (failAccount) return failure('outage',503);
  return Response.json({account_id:token, name:{display_name:token}});
 }
 if (route === 'auth/token/revoke') return Response.json(null);
 const args = JSON.parse(options.headers['Dropbox-API-Arg'] || options.body);
 assert(args.path.startsWith('/') && !args.path.includes('//'));
 const remoteKey = JSON.stringify([token,args.path]), old = remote.get(remoteKey);
 if (route === 'files/upload') {
  assert.equal(args.autorename,false); assert.equal(args.strict_conflict,true);
  if (args.mode['.tag'] === 'add' && old || args.mode['.tag'] === 'update' && args.mode.update !== old?.rev) return failure('path/conflict/file/');
  const next = {body:new Blob([options.body]), rev:(++revision).toString(16).padStart(9,'0')};
  remote.set(remoteKey,next); writes.push({uid:token,path:args.path});
  if (loseAck) { loseAck = false; throw new Error('Acknowledgement lost'); }
  return Response.json({rev:next.rev});
 }
 if (!old) return failure((route === 'files/delete_v2' ? 'path_lookup' : 'path') + '/not_found/');
 if (route === 'files/get_metadata') return Response.json({rev:old.rev});
 if (route === 'files/download') {
  if (afterGet) { const fn = afterGet; afterGet = null; fn(); }
  return new Response(old.body,{headers:{'Dropbox-API-Result':JSON.stringify({rev:old.rev})}});
 }
 if (route === 'files/delete_v2') {
  if (args.parent_rev !== old.rev) return failure('path_write/conflict/file/');
  remote.delete(remoteKey); return Response.json({metadata:{rev:old.rev}});
 }
 throw new Error('Unexpected route ' + route);
}
function fixture(overrides = {}, local = backups) {
 const nav = {onLine:true};
 const location = {origin:'https://arcade.test', assign:url=>location.assigned=url, replace:url=>location.replaced=url};
 const win = {top:{},navigator:nav,addEventListener(){},WrcadCloudConfig:{storagePrefix:prefix, appName:'CloudRcade', enabled:true, server:'https://nextcloud.test', legacyServer:'https://nextcloud.test',accessAllowed:true,
  dropbox:{enabled:true,appKey:'fixture-app'}, ...overrides}};
 const ctx = vm.createContext({window:win,navigator:nav,location,localStorage:storage(disk),sessionStorage:storage(session),fetch,Blob,Response,URL,URLSearchParams,AbortSignal,
  crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,btoa,unescape,console});
 vm.runInContext(source('dropbox'),ctx); vm.runInContext(source('bridge'),ctx);
 class Saves {
  constructor(){this.errors=[];this.errorCallback=e=>this.errors.push(e);}
  getZipFileName(p){return p.endsWith('.zip')?p:p+'.zip';}
  async loadLocal(p){return structuredClone(local.get(this.getZipFileName(p)) || null);}
  async saveLocal(p,files){local.set(this.getZipFileName(p),structuredClone(files));}
  async createZip(files){return new Blob([JSON.stringify(await Promise.all(files.map(async f=>({name:f.name,content:Array.from(f.content instanceof Blob?new Uint8Array(await f.content.arrayBuffer()):f.content)}))))]);}
  async getFiles(blob){return JSON.parse(await blob.text()).map(f=>({...f,content:new Uint8Array(f.content)}));}
  async checkFilesChanged(){return true;}
  async getStateSlots(prefix){try { return [null,JSON.parse(await (await this.loadCloudSingleFile(prefix+"state.1.json")).text())]; } catch(e) { if(e.status===404)return [];throw e; }}
  async delete(p){local.delete(this.getZipFileName(p));}
 }
 win.WrcadCloud.install({saves:Saves});
 return {cloud:win.WrcadCloud,dropbox:win.WrcadDropbox,manager:new Saves(),ctx,location};
}
const files = n => [{name:'sav',content:new Uint8Array([n])}];
const value = files => files?.find(f=>f.name==='sav')?.content[0];
(async()=>{
 connect('alice');let a=fixture();
 assert.equal(a.cloud.providerName,'Dropbox');
 assert.equal(await a.manager.save('/nes/test',files(1)),true);
 const b=fixture({},new Map());assert.equal(value(await b.manager.load('/nes/test')),1,'second device sees same progress');
 offline=true;assert.equal(await a.manager.save('/nes/test',files(2)),false);offline=false;
 a=fixture();assert.equal(value(await a.manager.load('/nes/test')),2,'pending local progress recovers after restart');
 assert.equal(value(await b.manager.loadCloud('/nes/test')),2);
 await b.manager.load('/nes/test');await a.manager.save('/nes/test',files(3));
 assert.equal(await b.manager.save('/nes/test',files(4)),false,'stale update rejected');
 assert.equal(value(await b.manager.loadLocal('/nes/test')),4);
 assert.equal(value(await a.manager.loadCloud('/nes/test')),3);
 loseAck=true;assert.equal(await a.manager.save('/nes/test',files(5)),false);
 a=fixture();assert.equal(value(await a.manager.load('/nes/test')),5,'lost acknowledgement reconciles');
 assert.equal(await a.manager.save('/nes/test',files(6)),true,a.manager.errors.join('; '));
 // A new path create races another device; no rename or overwrite allowed.
 const create1=fixture({},new Map()),create2=fixture({},new Map());await create1.manager.load('/new/save');await create2.manager.load('/new/save');
 assert.equal(await create1.manager.save('/new/save',files(7)),true);
 assert.equal(await create2.manager.save('/new/save',files(8)),false);
 // Shared native state path and JSON metadata/thumbs use the same Dropbox transport.
 await a.manager.saveState('/states/',1,new Uint8Array([7,8]),null,null,'data:image/png;base64,fixture');
 const restored=(await b.manager.loadCloud('/states/state.1')).find(f=>f.name==='state').content;
 assert.deepEqual(Array.from(restored),[7,8]);
 const slots=await b.manager.getStateSlots('/states/');assert(slots[1].time);assert.equal(slots[1].shot,'data:image/png;base64,fixture');
 await b.manager.delete('/states/state.1'); await b.manager.deleteCloudSingleFile('/states/state.1.json');
 assert.equal(remote.has(JSON.stringify(['alice','/states/state.1.zip'])),false);
 assert.equal(remote.has(JSON.stringify(['alice','/states/state.1.json'])),false);
 // Both settings/history documents use ordinary conditional JSON transfers.
 for (const [load,save,doc] of [['loadControls','saveControls',{version:1,settings:{muted:true}}],['loadRecent','saveRecent',{version:1,entries:[]}]]) {
  await assert.rejects(a.cloud[load](),e=>e.status===404);await a.cloud[save](doc);assert.deepEqual(JSON.parse(JSON.stringify(await b.cloud[load]())),doc);
 }
 // Proactive refresh shared by concurrent calls; expired bearer retries once.
 let auth=JSON.parse(disk.get(key));auth.expires=0;disk.set(key,JSON.stringify(auth));
 let before=refreshes;await Promise.all([a.cloud.loadControls(),a.cloud.loadRecent()]);assert.equal(refreshes,before+1);
 invalidAccess=true;before=refreshes;await a.cloud.loadRecent();assert.equal(refreshes,before+1);
 // Refresh completion cannot overwrite a different account linked in another tab.
 auth=JSON.parse(disk.get(key));auth.expires=0;disk.set(key,JSON.stringify(auth));
 onToken=()=>connect('bob');await assert.rejects(a.cloud.loadRecent(),/account changed/i);assert.equal(JSON.parse(disk.get(key)).uid,'bob');
 const bob=fixture();assert.equal(await bob.manager.load('/nes/test'),null);
 const count=writes.length;assert.equal(await a.manager.save('/nes/test',files(99)),false);assert.equal(writes.length,count);
 // Switching provider while a game runs blocks cloud calls and preserves its original local namespace.
 connect('alice');const switching=fixture();await switching.manager.load('/nes/test');disk.set(prefix+'.cloud.provider.v1','nextcloud');
 await assert.rejects(switching.manager.saveCloud('/nes/test',files(90)),/account changed/i);
 disk.set(prefix+'.cloud.provider.v1','dropbox');
 const otherApp=fixture({dropbox:{enabled:true,appKey:'different-app',saveFolder:'CloudRcade'}});assert.equal(await otherApp.manager.load('/nes/test'),null);
 // A provider change during refresh must stop before its pending file request.
 connect('alice');auth=JSON.parse(disk.get(key));auth.expires=0;disk.set(key,JSON.stringify(auth));
 const refreshingClient=fixture();const requestCount=requests.filter(url=>url.includes('/2/files/')).length;
 onToken=()=>disk.set(prefix+'.cloud.provider.v1','nextcloud');
 await assert.rejects(refreshingClient.cloud.loadControls(),/account changed/i);
 assert.equal(requests.filter(url=>url.includes('/2/files/')).length,requestCount);
 disk.set(prefix+'.cloud.provider.v1','dropbox');
 // Path/size/version validation happens before any token-bearing transfer.
 const transport=fixture().dropbox;
 for (const path of ['../../private.zip','save/../private.zip','file.txt','/folder//file.zip']) await assert.rejects(transport.request('file',{uid:'alice',path}),e=>e.status===400);
 await assert.rejects(transport.request('file',{uid:'alice',method:'PUT',path:'valid.zip',body:'x'}),e=>e.status===428);
 await assert.rejects(transport.request('file',{uid:'alice',method:'PUT',path:'valid.zip',body:new Blob([new Uint8Array(67108865)]),extra:{'If-None-Match':'*'}}),e=>e.status===413);
 // The app registration owns the base folder. Obsolete cached save-folder
 // settings must never add a subfolder or change the Dropbox app identity.
 for(const folder of [undefined,'','Game Saves','CloudRcade','../bad',12]) {
  const configured=fixture({dropbox:{enabled:true,appKey:'fixture-app',saveFolder:folder}});
  const path='always-root.json';
  await configured.dropbox.request('file',{uid:'alice',method:'PUT',path,body:'{}',extra:{'If-None-Match':'*'}});
  const destination='/'+path;
  assert(remote.has(JSON.stringify(['alice',destination])));
  assert.equal(await (await configured.dropbox.request('file',{uid:'alice',path})).text(),'{}');
  await configured.dropbox.request('file',{uid:'alice',path,method:'HEAD'});
  await configured.dropbox.request('file',{uid:'alice',path,method:'DELETE'});
  assert(!remote.has(JSON.stringify(['alice',destination])));
 }
 // Real S256 construction and one-shot state-bound OAuth code exchange.
 disk.delete(key);const login=fixture();await login.dropbox.begin('https://arcade.test/play/?feed=test');
 const url=new URL(login.location.assigned),flow=JSON.parse(session.get(flowKey));
 assert.equal(url.origin,'https://www.dropbox.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('token_access_type'),'offline');
 assert.equal(url.searchParams.get('redirect_uri'),'https://arcade.test/cloud-saves/?provider=dropbox');
 const challenge=Buffer.from(await require('node:crypto').webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(flow.verifier))).toString('base64url');
 assert.equal(url.searchParams.get('code_challenge'),challenge);
 before=refreshes;await assert.rejects(login.dropbox.complete(new URLSearchParams({code:'code',state:'wrong'})),/another browser/);assert.equal(refreshes,before);
 failAccount=true;await assert.rejects(login.dropbox.complete(new URLSearchParams({code:'code',state:flow.state})));failAccount=false;
 assert(session.get(flowKey).includes('credential'));
 before=refreshes;assert.equal(await login.dropbox.complete(new URLSearchParams({code:'code',state:flow.state})),'https://arcade.test/play/?feed=test');assert.equal(refreshes,before,'code not exchanged again after account lookup outage');
 assert.equal(JSON.parse(disk.get(key)).uid,'alice');assert(!session.has(flowKey));
 await assert.rejects(login.dropbox.complete(new URLSearchParams({code:'code',state:flow.state})),/another browser/);
 // Authorization cancellation never replaces a previously linked account.
 await login.dropbox.begin('/play/');const cancelled=JSON.parse(session.get(flowKey));
 await assert.rejects(login.dropbox.complete(new URLSearchParams({error:'access_denied',state:cancelled.state})),/not granted/);
 assert.equal(JSON.parse(disk.get(key)).uid,'alice');
 // A failed deletion with stale revision preserves the newer file.
 const client=fixture();await client.manager.load('/nes/test');
 const k=JSON.stringify(['alice','/nes/test.zip']);remote.get(k).rev='fffffffff';
 await assert.rejects(client.dropbox.request('file',{uid:'alice',method:'DELETE',path:'nes/test.zip',extra:{'If-Match':'"000000001"'}}),e=>e.status===409);
 assert(remote.has(k));
 console.log('PASS Dropbox shared saves/states/metadata/delete/settings/history, cross-device conflicts, offline/lost-ack recovery, refresh/account/provider isolation and PKCE sign-in recovery');
})().catch(e=>{console.error(e);process.exitCode=1;});
