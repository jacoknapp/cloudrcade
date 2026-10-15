// Metadata selection ownership, cancellation and recovery; no network/accounts.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../deploy/webrcade/touch/assets/metadata.js'),'utf8');
const item=rom=>({type:'nes',props:{rom:'/content/'+rom+'.nes'}});
const response=value=>({ok:true,json:async()=>value});
const ready=()=>response({available:true,metadata:{description:'Recovered'}});
const flush=()=>new Promise(setImmediate);
function fixture(provider){
 let time=0,id=0,updates=0,unmounts=0;const timers=new Map(),calls=[];
 class Browse{constructor(){this.props={hide:false,disable:false};this.state={menuMode:'apps',searchTerm:'',currentItem:item('first')};}forceUpdate(){updates++;this.componentDidUpdate();}componentDidUpdate(){return 'updated';}componentWillUnmount(){unmounts++;return 'closed';}}
 const window={};vm.runInNewContext(source,{window,URL,TextEncoder,Uint8Array,AbortController,
  crypto:{subtle:{digest:async(_,bytes)=>Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer}},
  setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},clearTimeout:key=>timers.delete(key),
  fetch:async(url,options)=>{calls.push({url,...options});return provider(calls.length,options);}});
 window.WrcadMetadata.install({Browse});window.WrcadMetadata.install({Browse});const browse=new Browse();
 async function advance(ms){const until=time+ms;let steps=0;for(;;){await flush();const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert(++steps<100,'timer loop');time=due[1].at;timers.delete(due[0]);due[1].fn();}time=until;await flush();}
 return{browse,calls,timers,advance,get updates(){return updates;},get unmounts(){return unmounts;}};
}
(async()=>{
 let f=fixture(ready);assert.equal(f.browse.componentDidUpdate(),'updated');f.browse.componentDidUpdate();await f.advance(350);await f.advance(20000);
 assert.equal(f.calls.length,1);assert.equal(f.updates,1);assert(f.calls[0].url.endsWith(crypto.createHash('sha256').update(JSON.stringify(['nes','/content/first.nes'])).digest('hex')));assert.equal(f.calls[0].credentials,'same-origin');assert.equal(f.calls[0].cache,'no-store');
 for(const action of ['hide','disable','category','unmount'])for(const pending of [false,true]){
  f=fixture(()=>response({available:false,pending:true}));f.browse.componentDidUpdate();if(pending)await f.advance(350);
  if(action==='hide')f.browse.props.hide=true;
  if(action==='disable')f.browse.props.disable=true;
  if(action==='category')f.browse.state.menuMode='categories';
  if(action==='unmount')assert.equal(f.browse.componentWillUnmount(),'closed');else f.browse.componentDidUpdate();
  await f.advance(20000);assert.equal(f.calls.length,pending?1:0,action+' cancels debounce/retries');assert.equal(f.timers.size,0);
  if(action==='unmount'){f.browse.componentDidUpdate();await f.advance(20000);assert.equal(f.unmounts,1);assert.equal(f.calls.length,pending?1:0);}
 }
 // Simulate a transport ignoring abort: its late reply must not mutate either item.
 let finish;f=fixture(count=>count===1?new Promise(resolve=>finish=resolve):ready());f.browse.componentDidUpdate();await f.advance(350);const old=f.browse.state.currentItem;
 f.browse.state.currentItem=item('second');f.browse.componentDidUpdate();assert(f.calls[0].signal.aborted);finish(response({available:true,metadata:{description:'Stale'}}));await flush();await flush();assert.equal(old.description,undefined);
 await f.advance(350);assert.equal(f.browse.state.currentItem.description,'Recovered');assert.equal(f.calls.length,2);
 for(const kind of ['network','http','json']){
  f=fixture(count=>{if(count>1)return ready();if(kind==='network')throw Error('offline');if(kind==='http')return{ok:false};return{ok:true,json:async()=>{throw Error('bad json');}};});
  f.browse.componentDidUpdate();await f.advance(350);await f.advance(1200);assert.equal(f.calls.length,2,kind+' recovers');assert.equal(f.browse.state.currentItem.description,'Recovered');
 }
 let online=false;f=fixture(()=>{if(!online)throw Error('offline');return ready();});f.browse.componentDidUpdate();await f.advance(100000);assert.equal(f.calls.length,3);assert.equal(f.timers.size,0,'failure retry budget is bounded');
 online=true;f.browse.props.hide=true;f.browse.componentDidUpdate();f.browse.props.hide=false;f.browse.componentDidUpdate();await f.advance(350);assert.equal(f.calls.length,4);assert.equal(f.browse.state.currentItem.description,'Recovered');
 f=fixture((count,{signal})=>count===1?new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true})):ready());f.browse.componentDidUpdate();await f.advance(350);await f.advance(8000);assert(f.calls[0].signal.aborted);await f.advance(1200);assert.equal(f.calls.length,2);assert.equal(f.browse.state.currentItem.description,'Recovered');
 f=fixture(count=>count===1?response({available:true,metadata:{description:'Stale cache'},pending:true,retryAfterMs:300000}):ready());f.browse.componentDidUpdate();await f.advance(350);assert.equal(f.browse.state.currentItem.description,'Stale cache');await f.advance(299999);assert.equal(f.calls.length,1,'provider cooldown respected');await f.advance(1);assert.equal(f.calls.length,2);assert.equal(f.browse.state.currentItem.description,'Recovered');
 f=fixture(()=>response({available:false}));f.browse.componentDidUpdate();await f.advance(350);f.browse.componentDidUpdate();await f.advance(20000);assert.equal(f.calls.length,1,'definitive misses do not poll');
 console.log('PASS metadata selection/debounce/pending/in-flight cancellation, stale response isolation, identity, network/HTTP/JSON/timeout recovery, bounded retries/reselection, provider cooldown and definitive misses');
})().catch(error=>{console.error(error);process.exitCode=1;});
