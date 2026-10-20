/* Execute the shipped native pre-js cache with actual Wasm functions/tables. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const patch=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-dolphin/native-patches/0002-reuse-wasm-instances.patch'),'utf8');
const nativePath='Source/Core/Core/PowerPC/CachedInterpreter/WasmInstanceCache.js';
const section=patch.split('diff --git a/'+nativePath+' b/'+nativePath+'\n')[1];
assert(section?.includes('new file mode 100644'),'exercise the entire shipped native pre-js file');
const {execFileSync}=require('node:child_process'),os=require('node:os');
// Apply every patch touching the helper, so this test exercises the currently
// shipped implementation rather than the initial pre-recycling version.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gamecube-instance-test-'));
let helper;
try{
 const dir=path.join(__dirname,'../deploy/webrcade/retro-dolphin/native-patches');
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.patch')).sort())
  execFileSync('git',['apply','--include='+nativePath,path.join(dir,name)],{cwd:tmp,stdio:'pipe'});
 helper=fs.readFileSync(path.join(tmp,nativePath),'utf8');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const bytes=new Uint8Array([0,97,115,109,1,0,0,0,1,6,1,96,1,127,1,127,3,3,2,0,0,7,9,2,1,97,0,0,1,98,0,1,10,17,2,7,0,32,0,65,1,106,11,7,0,32,0,65,2,106,11]);
const functions=new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
function owned(){const Module={},wasmTable=new WebAssembly.Table({element:'anyfunc',initial:2});wasmTable.set(0,functions.a);wasmTable.set(1,functions.b);vm.runInNewContext(helper,{Module,wasmTable});return {cache:Module._dolphinWasmInstances,table:wasmTable};}
const first=owned(),a=first.cache.insert('verified-bytes',[0,1],functions.a);assert.equal(first.table.get(a)(5),6);
assert.equal(first.cache.get('verified-bytes',[0,1]),a,'same code/imports reuse the original immutable function');
assert.equal(first.cache.insert('verified-bytes',[0,1],functions.b),a,'duplicate allocation cannot overwrite a native callback handle');
assert.equal(first.table.length,3);assert.equal(first.table.get(a)(17),18,'the reused function still handles changing CPU state arguments');
assert.equal(first.cache.get('verified-bytes',[1,0]),undefined,'different helper bindings cannot alias');
const b=first.cache.insert('verified-bytes',[1,0],functions.b);assert.notEqual(a,b);assert.equal(first.table.get(b)(5),7);assert.equal(first.table.get(a)(5),6);
const c=first.cache.insert('different-code',[0,1],functions.b);assert.notEqual(c,a);
const second=owned();assert.equal(second.cache.get('verified-bytes',[0,1]),undefined,'each CPU worker has its own table/cache');
second.cache.insert('verified-bytes',[0,1],functions.b);assert.equal(second.table.get(2)(5),7);assert.equal(first.table.get(a)(5),6);
for(let i=3;i<16384;i++)first.cache.insert('block-'+i,[0,1],functions.a);
assert(first.cache.full());const length=first.table.length;assert.equal(first.cache.insert('over-budget',[0,1],functions.b),0,'new blocks fall back without growing executable memory');assert.equal(first.table.length,length);assert.equal(first.cache.get('verified-bytes',[0,1]),a,'already compiled blocks remain accelerated at the budget');assert.equal(first.table.get(a)(5),6);
// Native callers must unlink all users first. Retiring one cold handle preserves
// every other executable and does not make a permanent helper reusable.
first.cache.retire(c);assert.equal(first.table.get(c),null);
assert.equal(first.cache.get('different-code',[0,1]),undefined);
first.cache.retire(c);first.cache.retire(0);
assert.equal(first.table.get(a)(5),6);assert.equal(first.table.get(b)(5),7);
const replacement=first.cache.insert('cold-replacement',[0,1],functions.b);
assert.equal(replacement,c);assert(first.cache.full());assert.equal(first.cache.size(),16384);
assert.equal(first.table.length,length);assert.equal(first.table.get(0)(5),6);
// Only the CPU safe-point after ClearCache may call reset. All retired callback
// slots become null, while permanent helper slots and another worker survive.
first.cache.reset();assert.equal(first.cache.size(),0);assert(!first.cache.full());
for(let i=2;i<length;i++)assert.equal(first.table.get(i),null,'retired instances must not stay rooted by the table');
assert.equal(first.table.get(0)(5),6);assert.equal(first.table.get(1)(5),7);
assert.equal(second.table.get(2)(5),7);
for(let i=0;i<16384;i++)first.cache.insert('next-scene-'+i,[0,1],functions.b);
assert.equal(first.table.length,length,'next scene reuses all handles without growing the table');
assert(first.cache.full());assert.equal(first.table.get(first.cache.get('next-scene-0',[0,1]))(5),7);
first.cache.reset();assert.equal(first.cache.size(),0);
for(let i=2;i<length;i++)assert.equal(first.table.get(i),null,'repeated reset releases every retired function');

const tightModule={},tightTable=new WebAssembly.Table({element:'anyfunc',initial:2,maximum:2});tightTable.set(0,functions.a);tightTable.set(1,functions.b);vm.runInNewContext(helper,{Module:tightModule,wasmTable:tightTable});assert.equal(tightModule._dolphinWasmInstances.insert('new',[0],functions.a),0,'browser table allocation refusal falls back without trapping the CPU worker');assert.equal(tightTable.get(0)(5),6);
console.log('PASS real Wasm handle reuse, code/import identity, state arguments, worker isolation, no active-handle overwrite, bounded executable table and retired-function release');
