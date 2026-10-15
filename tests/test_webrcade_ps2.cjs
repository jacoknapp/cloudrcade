/* PS2 disc protocol, >4GiB offsets, bounded memory and Sony input contracts. */
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const root=path.resolve(__dirname,'../deploy/webrcade/retro-play/app');
(async()=>{
 const {remoteDisc,DiscDevice,CHUNK,LIMIT}=await import(pathToFileURL(path.join(root,'disc.mjs')));
 const {inputState,BUTTONS}=await import(pathToFileURL(path.join(root,'input.mjs')));
 const {validCard}=await import(pathToFileURL(path.join(root,'saves.mjs')));
 global.location={href:'https://arcade.example.test/play/'};
 let mode='good',bodyReads=0,canceled=0,requests=[];const size=5*1024**3+123;
 global.fetch=async(url,options)=>{
  if(options.method==='HEAD')return new Response(null,{headers:{'Content-Length':String(size),'ETag':'"disc-v1"'}});
  requests.push(options.headers.Range);assert.equal(options.headers['If-Range'],'"disc-v1"');
  const [,start,end]=/bytes=(\d+)-(\d+)/.exec(options.headers.Range).map(Number);
  const status=mode==='full'?200:206;
  const bytes=new Uint8Array(end-start+1);for(let i=0;i<bytes.length;i++)bytes[i]=(start+i)%251;
  const response=new Response(new ReadableStream({pull(controller){bodyReads++;controller.enqueue(mode==='short'?bytes.subarray(1):bytes);controller.close();},cancel(){canceled++;}}),{status,headers:{'Content-Range':`bytes ${start}-${end}/${size}`,'ETag':mode==='changed'?'"disc-v2"':'"disc-v1"'}});
  return response;
 };
 const disc=await remoteDisc('/content/ps2/Game.iso');assert.equal(disc.size,size);
 const offset=2**32+CHUNK-16,bytes=await disc.read(offset,64);
 assert.deepEqual([...bytes],Array.from({length:64},(_,index)=>(offset+index)%251));
 assert.equal((await disc.read(size-3,16)).length,3);assert.equal((await disc.read(size,10)).length,0);
 for(let i=0;i<20;i++)await disc.read(i*CHUNK,64);
 assert(disc.cachedBytes<=CHUNK*LIMIT);assert(disc.transferred<size,'no complete DVD read');
 const module={HEAPU8:new Uint8Array(CHUNK*3)},errors=[];
 const device=new DiscDevice(module,disc,error=>errors.push(error));device.read(0,CHUNK-8,CHUNK+32);
 while(!device.isDone())await new Promise(resolve=>setTimeout(resolve,1));assert.equal(device.result(),CHUNK+32);
 assert.equal(module.HEAPU8[0],(CHUNK-8)%251);assert.deepEqual(errors,[]);
 device.close();assert.equal(disc.cachedBytes,0);await assert.rejects(disc.read(0,1),/closed/);
 for(const bad of ['full','short','changed']){mode=bad;await assert.rejects(remoteDisc('/content/game.iso'),/ranges|Incomplete|changed/);}
 assert(canceled>=0);assert(bodyReads>0);
 const axes=inputState(new Set(['CROSS','L2','KeyH','KeyI']),null,{isControlDown:cid=>cid===13,getAxisValue:()=>0});
 assert(axes[0]&(1<<BUTTONS.CROSS));assert(axes[0]&(1<<BUTTONS.L2));assert(axes[0]&(1<<BUTTONS.START));assert.deepEqual(axes.slice(1),[255,128,128,1]);
 const pad=inputState(new Set(),{buttons:[{pressed:true}],axes:[-.5,.25,1,-1]});assert(pad[0]&(1<<BUTTONS.CROSS));assert.deepEqual(pad.slice(1),[65,160,255,1]);
 for(const name of ['mc0/save/data.bin','mc1/BASLUS/icon.sys'])assert(validCard(name));
 for(const name of ['../secret','mc0/../config','mc0/./file','/mc0/file','mc2/file','mc0//file','mc0/a\0b'])assert(!validCard(name),name);
 global.WrcadCloudConfig={storagePrefix:'metric_test'};const preferences=new Map();global.localStorage={getItem:key=>preferences.get(key)||null};
 const {enabled,perfEnabled}=await import(pathToFileURL(path.join(root,'preferences.mjs')));
 assert.equal(enabled(),false);assert.equal(perfEnabled(),false);preferences.set('metric_test.ps2.enabled.v1','1');assert(enabled());
 global.document={createElement:()=>({setAttribute(){},remove(){},textContent:''}),body:{append(){}}};
 const {Ps2Performance}=await import(pathToFileURL(path.join(root,'perf.mjs')));
 let rendered=10,video=20;
 const monitor=new Ps2Performance({getFrames:()=>rendered,getVideoFrames:()=>video,getVideoRate:()=>60,HEAPU8:{length:256*1024**2}},{});
 assert(monitor.element.hidden,'readout off by default');monitor.sample(1000);rendered+=30;video+=60;monitor.sample(2000);
 assert(monitor.details.includes('30.0 FPS')&&monitor.details.includes('100% normal speed'),'rendered presents and emulated timing stay separate');
 preferences.set('metric_test.ps2.perf.v1','1');rendered+=30;video+=60;monitor.sample(3000);assert(!monitor.element.hidden);
 monitor.reset(true);monitor.sample(4000);assert.equal(monitor.element.textContent,'PS2 paused');monitor.dispose();
 const {pictureBounds}=await import(pathToFileURL(path.join(root,'viewport.mjs')));
 const windowOf=(width,height)=>{const value={innerWidth:width,innerHeight:height};value.top=value;return value;};
 for(const [width,height]of [[320,568],[390,844],[768,1024],[844,390]]){
  const parent=windowOf(width,height),scope=windowOf(width,height+60);scope.top=parent;scope.parent=parent;scope.frameElement={clientLeft:0,clientTop:0,getBoundingClientRect:()=>({left:0,top:0})};
  const safe={left:0,top:0,right:width,bottom:height+60},rect=pictureBounds({scope,safe,touch:true,controls:true});
  assert(rect.left>=0&&rect.top>=0&&rect.left+rect.width<=width+.01&&rect.top+rect.height<=height+.01,'picture fits the parent window');
  if(height>width)assert(rect.top+rect.height<=height-(width<600?370:280)-12-20+.01,'picture clears fixed default controls and gap');
  else assert.equal(rect.height,height,'landscape uses the visible window height');
  assert(Math.abs(rect.width/rect.height-4/3)<.00001);
 }
 // GPU requests acknowledge failures and use the current grown shared heap.
 const {Ps2Gpu}=await import(pathToFileURL(path.join(root,'gpu.mjs')));
 const core={HEAPU8:new Uint8Array(new SharedArrayBuffer(1024))},gpuErrors=[];
 const gpu=new Ps2Gpu(core,error=>gpuErrors.push(error.message));
 let presented=0;
 gpu.module={HEAPU8:new Uint8Array(8*1024*1024),_malloc:()=>16,_free(){},_gpu_write(pointer,count){assert.equal(count,3);assert.deepEqual([...this.HEAPU8.subarray(pointer,pointer+12)],Array.from({length:12},(_,i)=>i));},_gpu_present(){presented++;return 1;},_gpu_destroy(){},async ccall(name){assert.equal(name,'gpu_wait');await new Promise(resolve=>setTimeout(resolve,2));}};
 core.HEAPU8.set(Array.from({length:12},(_,i)=>i),16);
 gpu.nativeCall(1,16,12,0,128);await gpu.chain;assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),32),1);
 core.HEAPU8=new Uint8Array(new SharedArrayBuffer(2048));
 gpu.nativeCall(3,16,32,0,128);await gpu.chain;assert.equal(presented,1);assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),32),2);
 gpu.nativeCall(99,0,0,0,128);await gpu.chain;assert.equal(Atomics.load(new Int32Array(core.HEAPU8.buffer),32),-1);assert.match(gpuErrors[0],/Invalid PS2 graphics command/);
 await gpu.dispose();assert.equal(gpu.module,null);assert.doesNotThrow(()=>gpu.nativeCall(1,0,12,0,128));
 const nativeFailure=new Ps2Gpu(core,error=>assert.match(error.message,/WebGPU operation failed/));nativeFailure.fail(17);await nativeFailure.dispose();
 console.log('PASS PS2 strict range reads, >4GiB offsets, LRU budget, cleanup, DualShock input and save path isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
