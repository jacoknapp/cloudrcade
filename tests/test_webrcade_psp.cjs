// PSP adapter boundaries: disabled boot, independent inputs, memory ownership,
// and save-before-cleanup. No ROMs, accounts or WebAssembly needed.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,
  '../deploy/webrcade/retro-ppsspp/app/src/emulator/index.js'),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export class Emulator','class Emulator')+'\nglobalThis.Emulator=Emulator;';
class Wrapper { constructor(){ ['A','X','SELECT','START','UP','DOWN','LEFT','RIGHT','B','Y','LBUMP','RBUMP'].forEach((n,i)=>this['INP_'+n]=1<<i); } }
const context={RetroAppWrapper:Wrapper,Prefs:class{},LazyRom:class{},DisplayLoop:class{},
  LOG:{error:()=>{}},window:{WrcadCloudConfig:{storagePrefix:'test'}},localStorage:{getItem:()=>null},
  document:{removeEventListener:()=>{}},setTimeout,clearTimeout,SharedArrayBuffer};
vm.createContext(context);vm.runInContext(source,context);
const emu=new context.Emulator({});
(async()=>{
  await assert.rejects(emu.loadEmscriptenModule({}),/Enable PSP in Experimental Settings/);
  const calls=[];const module={_simulate_input:(...args)=>calls.push(args)};
  emu.applyInput(module,0,emu.INP_A|emu.INP_UP,.75,-.5);
  assert(calls.some(a=>a[1]===0&&a[2]===1),'cross reaches libretro B');
  assert(calls.some(a=>a[1]===4&&a[2]===1),'D-pad up remains digital');
  assert(calls.some(a=>a[1]===16&&a[2]===24575),'left analog remains independent');
  assert(calls.some(a=>a[1]===19&&a[2]===16384),'negative analog Y');
  calls.length=0;emu.applyInput(module,0,0,0,0);
  assert(calls.length>=4&&calls.every(a=>a[2]===0),'all held inputs release');
  const freed=[];context.window.Module={_save_state_info:()=>64,
    UTF8ToString:()=> '4|16|1',_free:n=>freed.push(n),HEAPU8:new Uint8Array(64)};
  context.window.Module.HEAPU8.set([1,2,3,4],16);
  emu.captureStateScreenshot=async()=>null;emu.saveStatePrefix='test/';
  let stored;emu.getSaveManager=()=>({saveState:async(...args)=>{stored=args}});
  await emu.saveStateForSlot(2);assert.deepEqual(Array.from(stored[2]),[1,2,3,4]);
  assert.deepEqual(freed,[64,16],'both state metadata and byte allocations are freed');
  const cleanup=[];context.window.Module={_toggleMainLoop:v=>cleanup.push(['loop',v]),
    PThread:{terminateAllThreads:()=>cleanup.push(['threads'])},
    RWA:{context:{state:'running',close:async()=>cleanup.push(['audio'])}}};
  emu.lazyRom={chunks:new Map([[0,new Uint8Array(2)]])};
  await emu.dispose();assert.equal(emu.lazyRom.chunks.size,0);
  assert.deepEqual(cleanup,[['loop',0],['threads'],['audio']]);
  console.log('PASS PSP opt-in gate, independent analog/D-pad/face inputs, state allocation ownership and exit cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
