/* Exercise the actual worker with browser-compatible Request/Response doubles. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const origin = 'https://arcade.example.test';
const entries = new Map(), handlers = {};
let fetcher, calls = 0, failWrite = false, skips = 0;
const cache = {
  match: async key => entries.get(String(key))?.clone(),
  put: async (key, response) => {
    if (failWrite) throw new Error('QuotaExceededError');
    entries.set(String(key), response.clone());
  }
};
const sandbox = {URL, Request, Response, Headers, Blob, Promise, console,
  setTimeout, clearTimeout, caches:{open:async()=>cache},
  fetch:async request => { calls++; return fetcher(request); },
  self:{location:{origin,href:origin+'/touch-controls/offline-worker.js?cache=wrcad-arcade-offline-v1'}, navigator:{onLine:true}, clients:{claim:async()=>{}},
    skipWaiting:async()=>{skips++},addEventListener:(name, callback)=>handlers[name]=callback}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('deploy/webrcade/touch/assets/offline-worker.js','utf8'),sandbox);
const good = (body, type='application/octet-stream', status=200) => new Response(body,{status,headers:{'Content-Type':type}});
async function request(path, init={}, browser={}) {
  const pending=[]; let result;
  // Node cannot construct page-load requests; overlay the browser-only fields.
  const real=new Request(origin+path,init), made=new Proxy(real,{get:(target,name)=>
    name in browser?browser[name]:typeof target[name]==='function'?target[name].bind(target):target[name]});
  handlers.fetch({request:made,waitUntil:p=>pending.push(p),respondWith:p=>result=p});
  if (!result) return null;
  const response=await result;
  await Promise.all(pending);
  return response;
}
async function main() {
  const installation=[];
  fetcher=async()=>{throw new Error('Protected request during sign-in')};
  handlers.install({waitUntil:p=>installation.push(p)});
  await Promise.all(installation);
  assert.equal(calls,0,'worker install/update must not fetch protected pages during sign-in');
  assert.equal(skips,1,'new worker activates promptly');
  console.log('PASS worker installation needs no authenticated page/feed requests');
  const warming=[];
  fetcher=async url=>String(url).endsWith('.json')?good('{}','application/json'):good('page /touch-controls/offline.js','text/html');
  handlers.message({data:{type:'warm',urls:[origin+'/play/',origin+'/content/feeds/combined.json']},waitUntil:p=>warming.push(p)});
  await Promise.all(warming);
  assert(entries.has(origin+'/play/') && entries.has(origin+'/content/feeds/combined.json'),'loaded app still warms its shell and feed');
  entries.clear();calls=0;
  console.log('PASS app-driven warming preserves first-visit offline shell/feed caching');
  for (const feed of ['/content/feeds/combined.json', 'https://catalog.example.com/feed.json']) {
    const listeners = {};
    const fixture = {...sandbox, self:{...sandbox.self,
      location:{origin, href:origin+'/touch-controls/offline-worker.js?feed='+encodeURIComponent(feed)},
      addEventListener:(name, callback)=>listeners[name]=callback}};
    vm.createContext(fixture);
    vm.runInContext(fs.readFileSync('deploy/webrcade/touch/assets/offline-worker.js','utf8'),fixture);
    let result;
    listeners.fetch({request:{url:origin+'/',method:'GET',headers:new Headers(),mode:'navigate'},respondWith:p=>result=p});
    const response=await result;
    assert.equal(new URL(response.headers.get('Location')).searchParams.get('feed'),new URL(feed,origin).href);
  }
  console.log('PASS offline root resolves relative and absolute configured feeds');
  fetcher=async()=>good('abcdefghij');
  assert.equal(await (await request('/content/nes/roms/game.nes')).text(),'abcdefghij');
  sandbox.self.navigator.onLine=false;
  fetcher=async()=>{throw new Error('offline')};
  assert.equal(await (await request('/content/nes/roms/game.nes')).text(),'abcdefghij');
  for (const [range,body,content] of [['bytes=2-5','cdef','bytes 2-5/10'],['bytes=7-','hij','bytes 7-9/10'],['bytes=-3','hij','bytes 7-9/10'],['bytes=8-99','ij','bytes 8-9/10']]) {
    const r=await request('/content/nes/roms/game.nes',{headers:{Range:range}});
    assert.equal(r.status,206);assert.equal(await r.text(),body);assert.equal(r.headers.get('Content-Range'),content);
  }
  for(const range of ['bytes=11-','bytes=5-2','bytes=-0','bytes=-','bytes=0-1,4-5'])
    assert.equal((await request('/content/nes/roms/game.nes',{headers:{Range:range}})).status,416);
  const head=await request('/content/nes/roms/game.nes',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await request('/content/nes/roms/missing.nes')).status,503);
  assert.equal(calls,2,'cached offline reads do not fetch');
  console.log('PASS full ROM offline reads, HEAD, valid/invalid byte ranges, uncached failure');

  sandbox.self.navigator.onLine=true;
  fetcher=async()=>good('partial','application/octet-stream',206);
  await request('/content/derived/partial.chd',{headers:{Range:'bytes=0-6'}});
  assert(!entries.has(origin+'/content/derived/partial.chd'));
  fetcher=async()=>good('login','text/html');
  await request('/content/nes/roms/login.nes');
  assert(!entries.has(origin+'/content/nes/roms/login.nes'));
  assert.equal(await (await request('/content/nes/roms/game.nes')).text(),'abcdefghij');
  fetcher=async()=>Response.redirect('https://auth.example/login');
  assert.equal(await (await request('/content/nes/roms/game.nes')).text(),'abcdefghij');
  // An expired login on a page load reaches the sign-in page, except in a game frame.
  const expired={type:'opaqueredirect',status:0,redirected:false,url:'',headers:new Headers(),clone(){return this}};
  fetcher=async()=>good('page /touch-controls/offline.js','text/html');await request('/play/');
  fetcher=async()=>expired;
  assert.equal(await request('/play/',{},{mode:'navigate',destination:'document'}),expired);
  assert.equal(await (await request('/play/',{},{mode:'navigate',destination:'iframe'})).text(),'page /touch-controls/offline.js');
  assert.equal(await (await request('/play/')).text(),'page /touch-controls/offline.js');
  for(const path of ['/cloud-saves/api.php?action=status','/cloud-saves/api.php?action=file&path=sav.zip','/cloud-saves/?auto=1','/play/cors.php?x=a','/outpost.goauthentik.io/start','/play/dropbox/index.html'])
    assert.equal(await request(path),null,path);
  assert.equal(await request('/content/nes/roms/game.nes',{headers:{Authorization:'Basic fake'}}),null);
  assert.equal(await request('/content/nes/roms/game.nes',{method:'POST'}),null);
  console.log('PASS excludes auth/API traffic, credentials, login redirects/HTML, partial discs; expired login reaches sign-in');

  fetcher=async()=>good('old','application/javascript');await request('/touch-controls/controller.js?v=1');
  fetcher=async()=>good('new','application/javascript');assert.equal(await (await request('/touch-controls/controller.js?v=1')).text(),'new');
  fetcher=async()=>{throw new Error('network down')};assert.equal(await (await request('/touch-controls/controller.js?v=1')).text(),'new');
  fetcher=async()=>good('page /touch-controls/offline.js','text/html');await request('/play/app/retro-fceumm/?props=first');
  fetcher=async()=>{throw new Error('offline')};assert.equal(await (await request('/play/app/retro-fceumm/index.html?props=other')).text(),'page /touch-controls/offline.js');
  assert(!entries.has(origin+'/play/app/retro-fceumm/?props=first'));
  fetcher=async()=>good('download');failWrite=true;
  assert.equal(await (await request('/content/gb/roms/one.gb')).text(),'download');failWrite=false;
  assert(!entries.has(origin+'/content/gb/roms/one.gb'));
  sandbox.self.navigator.storage={estimate:async()=>({quota:128*1024*1024,usage:100*1024*1024})};
  assert.equal(await (await request('/content/gb/roms/reserved.gb')).text(),'download');
  assert(!entries.has(origin+'/content/gb/roms/reserved.gb'));
  console.log('PASS online asset refresh, offline fallback, launch URL normalization, quota failure and save headroom');
}
main().catch(error=>{console.error(error);process.exitCode=1});
