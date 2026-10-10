// Exercise the actual patched RetroArch keyboard bridge and synchronous app prompt.
// WEBRCADE_BUILD_ROOT points to a patched build.sh WORK tree.
const vm=require('vm'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const code=fs.readFileSync(path.join(process.env.WEBRCADE_BUILD_ROOT||'/tmp/retro-azahar-build','RetroArch/emscripten/emulatorjs.js'),'utf8');
const heap=new Uint8Array(65536);let next=256,unwinds=0,library;
const utf8=new TextEncoder(),decode=new TextDecoder();
const context={Module:{},addToLibrary:o=>library=o,console:{error:()=>{}},_malloc:n=>{const p=next;next+=n;return p},lengthBytesUTF8:s=>utf8.encode(s).length,
 UTF8ToString:p=>decode.decode(heap.subarray(p,heap.indexOf(0,p))),stringToUTF8:(s,p)=>{heap.set(utf8.encode(s),p);heap[p+utf8.encode(s).length]=0},
 Asyncify:{handleSleep:fn=>{unwinds++;return new Promise(resolve=>fn(resolve));}},window:{prompt:()=>null}};
vm.runInNewContext(code,context);const fn=library.EmulatorJSShowKeyboard;
(async()=>{context.Module.getInputText=()=> 'Trainer';let p=fn(0,12,0);assert.equal(typeof p,'number');assert.equal(context.UTF8ToString(p),'Trainer');assert.equal(unwinds,0);
 context.Module.getInputText=()=> 'Étoile 🌙';p=fn(0,12,0);assert.equal(context.UTF8ToString(p),'Étoile 🌙');assert.equal(unwinds,0);
 context.Module.getInputText=()=>null;assert.equal(fn(0,12,0),0);assert.equal(unwinds,0);
 context.Module.getInputText=()=>Promise.resolve('Async');p=await fn(0,12,0);assert.equal(context.UTF8ToString(p),'Async');assert.equal(unwinds,1);
 context.Module.getInputText=()=>Promise.reject(Error('cancel'));assert.equal(await fn(0,12,0),0);
 const promptSource=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-azahar/app/src/emulator/textinput.js'),'utf8').replace('export function','function');
 const answers=['TOO LONG','Étoile'],messages=[];
 const promptContext={window:{prompt:(label,previous)=>{messages.push({label,previous});return answers.shift();}}};
 vm.runInNewContext(promptSource,promptContext);
 assert.equal(promptContext.requestGameText({hint:'Name?',maxLength:6}),'Étoile');assert.equal(messages.length,2);assert.equal(messages[1].previous,'TOO LONG');
 promptContext.window.prompt=()=>null;assert.equal(promptContext.requestGameText({hint:'Name?',maxLength:12}),null);
 promptContext.window.prompt=()=> '🌙🌙';assert.equal(promptContext.requestGameText({hint:'Name?',maxLength:4}),'🌙🌙');
 console.log('PASS synchronous UTF-8 text/cancellation never unwinds; Promise result/error contracts retained');})().catch(e=>{console.error(e);process.exitCode=1});
