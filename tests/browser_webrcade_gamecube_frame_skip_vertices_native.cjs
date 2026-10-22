// Compare the actual qualified portable vertex loader in Chromium and WebKit.
// Test-only worker hook calls a native smoke guarded against active gameplay.
const {chromium,webkit}=require('playwright');const assert=require('node:assert/strict');
const origin=process.env.WEBRCADE_GAMECUBE_ORIGIN||process.env.WEBRCADE_WII_ORIGIN,system=process.env.SYSTEM||'gamecube';
if(!origin)throw Error('Supply WEBRCADE_GAMECUBE_ORIGIN or WEBRCADE_WII_ORIGIN');
(async()=>{for(const engine of [chromium,webkit]){
 const b=await engine.launch(engine===webkit?{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}:{args:['--no-sandbox']});
 try{const c=await b.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),p=await c.newPage();await c.route('**/cloud-saves/config.php*',r=>r.fulfill({contentType:'text/javascript',body:'window.WrcadCloudConfig={enabled:false,storagePrefix:"native-skip-smoke"};'}));await p.route('**/vendor/src/upstream-discio-worker.js',async r=>{const response=await r.fetch();const source=await response.text();const anchor='    case "nativeTiming": {';assert.equal(source.split(anchor).length,2);await r.fulfill({response,body:source.replace(anchor,'    case "frameSkipVertexSmoke": return {result:moduleInstance._RunGraphicsFrameSkipVertexSmoke()};\n'+anchor)});});await p.goto(origin+'/experimental/'+system+'/');
 const result=await p.evaluate(async()=>{const {UpstreamWorkerAdapter}=await import('./vendor/src/upstream-worker-adapter.js');const a=new UpstreamWorkerAdapter({videoBackend:'Null',ppcWasmJit:false,noJitCache:true});try{await a.load();return await a.request('frameSkipVertexSmoke')}finally{a.rejectAll('Owned smoke finished');a.worker?.terminate()}});assert.equal(result.result,1);console.log('PASS',engine.name(),'real portable vertex loader, direct/index8/index16, matrix/normal/tangent caches, suppressed-index fallback');
 }finally{await b.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
