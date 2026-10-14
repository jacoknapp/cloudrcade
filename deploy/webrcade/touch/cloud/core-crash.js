/* Shared core crash journal and bounded automatic app-log delivery. */
(() => {
  'use strict';
  if(window.WrcadCoreCrash)return;
  const KEY='wrcad.core.active.v1',DURABLE=KEY+'.persistent',PENDING=KEY+'.reports';
  const phases=new Set(['starting','playing','paused','saving state','loading state','closing','failed']);
  const reasons=new Set(['interrupted','gpu-device-lost','gpu-completion','core-abort','core-timeout','no-frame-progress','worker-failure','unknown-runtime-failure','memory-failure','wasm-trap','gpu-validation','host-exception']);
  const fields=['frame','rendered','lastPresentMs','heapMiB','compiled','textures','bindings','shaders','failedShaders','gpuPending','gpuCompleted','gpuFenceMs','backlog','discWaitMaxMs'];
  const pathSystem=document.documentElement.dataset.cloudrcadeCore||location.pathname.match(/^\/play\/app\/([a-z0-9-]+)\//)?.[1];
  const system=pathSystem&&!['editor','standalone'].includes(pathSystem)?pathSystem:null;
  const reported=new Set();
  let record=null,lastWrite=0,sending=null,recovering=false,channel;
  try{channel=new BroadcastChannel('wrcad.core.activity.v1');}catch{}
  const read=(persistent=false)=>{try{return JSON.parse((persistent?localStorage:sessionStorage).getItem(persistent?DURABLE:KEY));}catch{return null;}};
  const pending=()=>{try{const value=JSON.parse(localStorage.getItem(PENDING));return Array.isArray(value)?value.slice(-8).map(item=>payload(item,item?.reason)).filter(Boolean):[];}catch{return [];}};
  const storePending=value=>{try{if(value.length)localStorage.setItem(PENDING,JSON.stringify(value));else localStorage.removeItem(PENDING);}catch{}};
  function clear(previous=record||read()){
    try{sessionStorage.removeItem(KEY);}catch{}
    if(previous?.id&&read(true)?.id===previous.id)try{localStorage.removeItem(DURABLE);}catch{}
    record=null;
  }
  function write(){
    if(!record)return;record.updated=Date.now();const value=JSON.stringify(record);
    try{sessionStorage.setItem(KEY,value);}catch{}
    try{localStorage.setItem(DURABLE,value);}catch{}
    lastWrite=performance.now();
  }
  function payload(previous,reason){
    if(!reasons.has(reason)||!previous||previous.version!==1||!phases.has(previous.phase)||!Number.isFinite(previous.updated)||
       previous.updated>Date.now()+60000||Date.now()-previous.updated>86400000)return null;
    const value={version:1,system:/^[a-z0-9-]{1,40}$/.test(previous.system)?previous.system:'gamecube',id:/^[a-z0-9-]{1,64}$/.test(previous.id)?previous.id:'legacy-'+Date.now().toString(36),reason,phase:previous.phase,updated:previous.updated};
    if(Number.isFinite(previous.started))value.started=previous.started;
    if(/^[A-Z0-9]{6}$/.test(previous.game))value.game=previous.game;
    for(const key of ['core','runtime'])if(/^[a-f0-9]{12}$/.test(previous[key]))value[key]=previous[key];
    value.sample=Object.fromEntries(fields.filter(key=>Number.isFinite(previous.sample?.[key])).map(key=>[key,previous.sample[key]]));
    return value;
  }
  async function deliver(value){
    try{
      const response=await fetch('/cloud-saves/core-crash-log.php',{method:'POST',credentials:'same-origin',keepalive:true,referrerPolicy:'no-referrer',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(5000)});
      return response.ok;
    }catch{return false;}
  }
  function flush(){
    if(sending)return sending;
    sending=(async()=>{
      for(;;){
        const value=pending()[0];if(!value)break;
        if(!await deliver(value))break;
        storePending(pending().filter(item=>!(item.id===value.id&&item.reason===value.reason)));
      }
    })().finally(()=>{sending=null;});return sending;
  }
  function report(previous,reason){
    const value=payload(previous,reason);if(!value)return;
    const signature=value.id+'|'+reason;if(reported.has(signature))return;reported.add(signature);
    if(reported.size>16)reported.delete(reported.values().next().value);
    console.error('[Core crash]',JSON.stringify(value));
    const reports=pending();if(!reports.some(item=>item.id===value.id&&item.reason===value.reason))reports.push(value);
    storePending(reports.slice(-8));
    // Storage-disabled browsers can still submit a caught runtime failure.
    if(!pending().some(item=>item.id===value.id&&item.reason===value.reason))void deliver(value);
    else void flush();
  }
  channel?.addEventListener('message',event=>{
    const value=event.data,owned=record||(document.querySelector('#webrcade-app-iframe')&&read());
    if(value?.type==='probe'&&owned?.id===value.id)channel.postMessage({type:'alive',id:value.id});
  });
  function alive(id){
    if(!channel||!id)return Promise.resolve(false);
    return new Promise(resolve=>{
      let timer;const finish=value=>{clearTimeout(timer);channel.removeEventListener('message',listener);resolve(value);};
      const listener=event=>{if(event.data?.type==='alive'&&event.data.id===id)finish(true);};
      channel.addEventListener('message',listener);timer=setTimeout(()=>finish(false),400);
      try{channel.postMessage({type:'probe',id});}catch{finish(false);}
    });
  }
  window.WrcadCoreCrash={
    begin(){if(record)return;const previous=read();if(previous)report(previous,'interrupted');record={version:1,system:system||'unknown',id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12),started:Date.now(),phase:'starting'};write();},
    identify(gameId,core,runtime){
      if(!record)return;
      if(/^[A-Z0-9]{6}$/.test(gameId))record.game=gameId;
      if(/^[a-f0-9]{64}$/.test(core))record.core=core.slice(0,12);
      if(/^[a-f0-9]{64}$/.test(runtime))record.runtime=runtime.slice(0,12);
      write();
    },
    phase(value){if(record&&phases.has(value)&&record.phase!==value){record.phase=value;write();}},
    sample(frame){
      if(!record||performance.now()-lastWrite<5000)return;
      const d=frame.gamecubeDiagnostics||{},r=d.resources||{};
      const sample={frame:frame.frame,rendered:d.render?.frames,lastPresentMs:d.render?.ageMs,heapMiB:frame.heapBytes/1048576,
        compiled:d.compiled,textures:r.textures,bindings:r.bindGroups,shaders:r.shaderOk,failedShaders:r.shaderFail,
        gpuPending:d.gpuQueue?.pending,gpuCompleted:d.gpuQueue?.completed,gpuFenceMs:d.gpuQueue?.lastCompletionMs,
        backlog:d.backlog,discWaitMaxMs:d.stream?.waitMaxMs};
      record.sample=Object.fromEntries(Object.entries(sample).filter(([,v])=>Number.isFinite(v)).map(([k,v])=>[k,Math.round(v)]));write();
    },
    fail(error){
      if(!record)return;record.phase='failed';write();
      const text=String(error?.message||error||''),reason=/out of memory|\bOOM\b|allocation failed|malloc failed/i.test(text)?'memory-failure':/memory access out of bounds|unreachable|RuntimeError/i.test(text)?'wasm-trap':/WebGPU.*validation/i.test(text)?'gpu-validation':/device.lost/i.test(text)?'gpu-device-lost':/gpu.completion/i.test(text)?'gpu-completion':
        /abort|core error/i.test(text)?'core-abort':/timed out/i.test(text)?'core-timeout':/stopped producing frames/i.test(text)?'no-frame-progress':
        /worker/i.test(text)?'worker-failure':'core-abort';
      report(record,reason);clear();
    },
    clear,
  };
  if(system){
    addEventListener('error',event=>{if(event.error&&record)report(record,'host-exception');});
    addEventListener('unhandledrejection',event=>{if(event.reason&&record)report(record,'host-exception');});
  }
  // Every standard SDK core assigns window.app before starting its emulator.
  // Intercept handled aborts as well as global errors; preserve exit's return value.
  const hooked=new WeakSet();
  function attach(app){
    if(!system||!app||typeof app.exit!=='function'||hooked.has(app))return;
    hooked.add(app);window.WrcadCoreCrash.begin();
    const exit=app.exit;
    app.exit=function(error,...args){
      const previous=record;
      if(error)window.WrcadCoreCrash.fail(error);else clear();
      try{
        const result=exit.call(this,error,...args);
        if(result&&typeof result.then==='function')return result.catch(e=>{report(previous,'host-exception');throw e;});
        return result;
      }catch(e){report(previous,'host-exception');throw e;}
    };
    const loaded=app.setModeToLoaded;
    if(typeof loaded==='function')app.setModeToLoaded=function(...args){window.WrcadCoreCrash.phase('playing');return loaded.apply(this,args);};
  }
  if(system&&system!=='gamecube'){
    let app=window.app;const descriptor=Object.getOwnPropertyDescriptor(window,'app');
    if(!descriptor||descriptor.configurable){
      Object.defineProperty(window,'app',{configurable:true,enumerable:true,get:()=>app,set:value=>{app=value;attach(value);}});
      attach(app);
    }
    // Uncaught dedicated-worker exceptions otherwise never reach window.error.
    const NativeWorker=window.Worker;
    if(NativeWorker)window.Worker=new Proxy(NativeWorker,{construct(target,args,newTarget){
      const worker=Reflect.construct(target,args,newTarget);
      worker.addEventListener('error',()=>{if(record)report(record,'worker-failure');});return worker;
    }});
  }
  // Retry only crash reports, at startup/online. Normal gameplay has no uploads.
  for(const [old,target,storage] of [['wrcad.gamecube.active.v1',KEY,'sessionStorage'],['wrcad.gamecube.active.v1.persistent',DURABLE,'localStorage']]){
    try{const value=window[storage].getItem(old);if(value&&!window[storage].getItem(target)){
      const previous=JSON.parse(value);previous.system='gamecube';window[storage].setItem(target,JSON.stringify(previous));
    }window[storage].removeItem(old);}catch{}
  }
  if(system&&system!=='gamecube')window.WrcadCoreCrash.begin();
  void flush();addEventListener('online',()=>void flush());
  if(window!==window.top||!/^\/play\/(?:index\.html)?$/.test(location.pathname))return;
  async function recover(){
    if(recovering||document.getElementById('webrcade-app-iframe'))return;
    const sessionRecord=read(),previous=sessionRecord||read(true);if(!previous)return;
    recovering=true;
    try{
      if(!sessionRecord&&await alive(previous.id))return;
      if(document.getElementById('webrcade-app-iframe'))return;
      if(!sessionRecord&&read(true)?.id!==previous.id)return;
      report(previous,'interrupted');clear(previous);
    }finally{recovering=false;}
  }
  function watch(){
    void recover();let hadFrame=!!document.getElementById('webrcade-app-iframe');
    new MutationObserver(()=>{const hasFrame=!!document.getElementById('webrcade-app-iframe');if(hadFrame&&!hasFrame)void recover();hadFrame=hasFrame;}).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch,{once:true});else watch();
})();
