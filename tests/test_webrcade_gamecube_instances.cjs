/* Execute the shipped native pre-js cache with actual Wasm functions/tables. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
const patch=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-dolphin/native-patches/0002-reuse-wasm-instances.patch'),'utf8');
const nativePath='Source/Core/Core/PowerPC/CachedInterpreter/WasmInstanceCache.js';
const section=patch.split('diff --git a/'+nativePath+' b/'+nativePath+'\n')[1];
assert(section?.includes('new file mode 100644'),'exercise the entire shipped native pre-js file');
const helper=section.split('\n').filter(line=>line.startsWith('+')&&!line.startsWith('+++')).map(line=>line.slice(1)).join('\n');
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
for(let i=3;i<32768;i++)first.cache.insert('block-'+i,[0,1],functions.a);
assert(first.cache.full());const length=first.table.length;assert.equal(first.cache.insert('over-budget',[0,1],functions.b),0,'new blocks fall back without growing executable memory');assert.equal(first.table.length,length);assert.equal(first.cache.get('verified-bytes',[0,1]),a,'already compiled blocks remain accelerated at the budget');assert.equal(first.table.get(a)(5),6);
const tightModule={},tightTable=new WebAssembly.Table({element:'anyfunc',initial:2,maximum:2});tightTable.set(0,functions.a);tightTable.set(1,functions.b);vm.runInNewContext(helper,{Module:tightModule,wasmTable:tightTable});assert.equal(tightModule._dolphinWasmInstances.insert('new',[0],functions.a),0,'browser table allocation refusal falls back without trapping the CPU worker');assert.equal(tightTable.get(0)(5),6);
console.log('PASS real Wasm handle reuse, code/import identity, state arguments, worker isolation, no active-handle overwrite, bounded executable table');
