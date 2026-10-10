const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../deploy/webrcade/touch/cloud/controller-sync.js'),'utf8');
let remote=null;
function browser(initial={}) {
 const data=new Map(Object.entries(initial)),events=[];
 const cloud={controlsAccount:()=> 'test-user',loadControls:async()=>{if(!remote)throw Object.assign(new Error('missing'),{status:404});return structuredClone(remote)},saveControls:async doc=>{remote=structuredClone(doc)}};
 const win={WrcadCloudConfig:{storagePrefix:'wrcad'},WrcadCloud:cloud,frames:[],addEventListener(){},dispatchEvent:e=>events.push(e),CustomEvent:class{constructor(type){this.type=type}}};
 vm.runInNewContext(code,{window:win,document:{addEventListener(){}},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},setTimeout(){},clearTimeout(){}});
 return {cloud,data,events};
}
(async()=>{
 const a=browser({'wrcad.touch.muted.v1':'true','wrcad.touch.translucence.v1':'20'});
 await a.cloud.syncControls();assert.equal(remote.settings.muted,true);assert.equal(remote.settings.translucence,20);
 const b=browser();await b.cloud.syncControls();assert.equal(b.data.get('wrcad.touch.muted.v1'),'true');
 b.data.set('wrcad.touch.muted.v1','false');b.cloud.controlsChanged({muted:false});await b.cloud.syncControls();
 await a.cloud.syncControls();assert.equal(a.data.get('wrcad.touch.muted.v1'),'false');assert(a.events.some(e=>e.type==='wrcad:controls-loaded'));
 a.cloud.controlsChanged({muted:'invalid'});await a.cloud.syncControls();assert.equal(remote.settings.muted,false);
 const loaded=()=>a.events.filter(e=>e.type==='wrcad:controls-loaded').length;const unchanged=loaded();await a.cloud.syncControls();assert.equal(loaded(),unchanged,'unchanged profile must not clear held controls');
 // An old profile without the optional flag imports a saved local mute on first connection.
 remote={version:1,settings:{enabled:true}};
 const c=browser({'wrcad.touch.muted.v1':'true'});await c.cloud.syncControls();assert.equal(remote.settings.muted,true);assert.equal(remote.settings.enabled,true);
 console.log('PASS saved mute upload, second-browser import, unmute propagation, boolean validation and old-profile compatibility');
})().catch(e=>{console.error(e);process.exitCode=1});
