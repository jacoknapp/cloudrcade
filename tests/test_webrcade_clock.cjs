const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../deploy/webrcade/touch/cloud/clock.js'),'utf8');
async function run(title, pokemon) {
 const heap=new Uint8Array(100000),rtcPtr=256,ramPtr=1024;
 let now=Date.parse('2026-09-22T14:20:45-05:00');
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const header=new Uint8Array(0x150);header.set(Buffer.from(title),0x134);header[0x147]=0x10;
 const disk=new Map();
 const wrapper={game:'game',mainStarted:true,SAVE_NAME:'sav',getScriptUrl:()=> 'js/sameboy_libretro.js',getRaConfigContents:()=> 'audio_latency = "64"',onFrame(){}};
 const Module={HEAPU8:heap,asm:{wrcad_memory_size:n=>n===1?32:32768,wrcad_memory_data:n=>n===1?rtcPtr:ramPtr}};
 const FS={open:()=>1,close(){},read:(s,b)=>b.set(header),writeFile:(p,b)=>disk.set(p,b),readFile:p=>{if(!disk.has(p))throw Error('missing');return disk.get(p)}};
 const win={Module};
 vm.runInNewContext(source,{window:win,Module,FS,Date:ClockDate,Uint8Array,DataView,BigInt,Blob,TextDecoder});
 const mgr={appWrapper:wrapper};await win.WrcadClock.restore(mgr,null);
 for (let i=0;i<512;i++) {
  const day=i%7,h=i%24,m=(i*7)%60,sec=(i*13)%60;
  if (pokemon) heap.set([day,h,m,sec],ramPtr+pokemon);
  heap[rtcPtr+3]=i&255;heap[rtcPtr+4]=(i>>8)&1;
  const before=new Uint8Array(heap);
  now=Date.parse('2026-09-22T14:20:45-05:00')+i*73123;
  win.WrcadClock.sync(wrapper,true);
  const r=heap.subarray(rtcPtr,rtcPtr+32),date=new Date(now);
  const total=r[2]*3600+r[1]*60+r[0]+(pokemon?h*3600+m*60+sec:0);
  assert.equal(total%86400,date.getHours()*3600+date.getMinutes()*60+date.getSeconds());
  assert.equal(((r[3]+((r[4]&1)<<8)+(pokemon?day:0)+Math.floor(total/86400))%7),date.getDay());
  assert.equal(Number(new DataView(heap.buffer,rtcPtr,32).getBigUint64(16,true)),Math.floor(now/1000));
  assert.deepEqual(heap.slice(ramPtr),before.slice(ramPtr),'game memory must be read-only');
  assert.deepEqual(heap.slice(rtcPtr+5,rtcPtr+16),before.slice(rtcPtr+5,rtcPtr+16),'latched RTC untouched');
 }
 // Moving device clock backwards must not freeze periodic synchronization.
 now-=3600*1000;wrapper.onFrame();
 assert.equal(Number(new DataView(heap.buffer,rtcPtr,32).getBigUint64(16,true)),Math.floor(now/1000));
 const rtc=new Uint8Array(heap.slice(rtcPtr,rtcPtr+32));disk.set('/home/web_user/retroarch/userdata/saves/game.rtc',rtc);
 const files=[{name:'sav',content:new Uint8Array([1,2,3])}];win.WrcadClock.capture(mgr,files);
 assert.equal(files.length,2);assert.equal(files[1].name,'clock.rtc');assert.deepEqual(files[0].content,new Uint8Array([1,2,3]));
 disk.clear();await win.WrcadClock.restore(mgr,files);assert.deepEqual(disk.get('/home/web_user/retroarch/userdata/saves/game.rtc'),rtc);
 disk.clear();await win.WrcadClock.restore(mgr,[{name:'clock.rtc',content:new Uint8Array(31)}]);assert.equal(disk.size,0,'ignore corrupt RTC');
}
(async()=>{for(const [title,offset] of [['PM_CRYSTAL\0BYTE',0x14b6],['POKEMON_GLDAAUE',0x11dc],['POKEMON_SLVAAXE',0x11dc],['RTC TEST',null]])await run(title,offset);console.log('PASS device hour/weekday across offsets and backward clock changes, read-only game/latched memory, RTC save/restore, corrupt RTC ignored');})().catch(e=>{console.error(e);process.exitCode=1});
