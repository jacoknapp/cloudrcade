// Execute exact extracted emitters against the pinned memory-based reference.
// Scripted imports deliberately mutate arbitrary FPRs, FPSCR, NPC and MSR, and
// request halt; import traces and all 2048 state bytes must match exactly.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.argv[2];
const seeds = [0n,0x8000000000000000n,0x3ff0000000000000n,0x3ff0000010000000n,
  0x0000000000000001n,0x0010000000000000n,0x7fefffffffffffffn,
  0x7ff0000000000000n,0xfff0000000000000n,0x7ff8000000001234n,0x7ff0000000001234n];
for (let i=0; i<16; ++i) seeds.push(BigInt.asUintN(64,0x123456789abcdefn*BigInt(i+1)*0x987654321n));
const modes = ['fast', 'helper', 'resume', 'halt1', 'halt3'];
let tests=0,totalRef=0,totalCached=0;
function run(module,seed,mode) {
  const memory = new WebAssembly.Memory({initial:1, maximum:1, shared:true});
  const state = new DataView(memory.buffer);
  for(let i=0;i<2048;i+=8) state.setBigUint64(i,BigInt.asUintN(64,seed+BigInt(i)*0x102030405n),true);
  for(let i=0;i<64;++i) state.setBigUint64(256+i*8,seeds[(i+Number(seed&15n))%seeds.length],true);
  state.setUint32(16,mode==='fast'?8192:0,true);
  const trace=[];
  function helper(...args) {
    trace.push(args);
    const n=trace.length;
    // The real helpers are responsible for arithmetic/status/exception details;
    // this fixture stresses their memory contract and register-cache coherency.
    for(let i=0;i<64;++i) state.setBigUint64(256+i*8, state.getBigUint64(256+i*8,true)^BigInt(i+n),true);
    state.setUint32(24,state.getUint32(24,true)^0x81800001,true); // status sentinel
    if(mode==='resume') state.setUint32(16,8192,true);
    const halt=mode===`halt${n}`;
    if(halt) state.setUint32(20,0x80001234,true);
    return halt?1:0;
  }
  const env={memory};
  for(const {name,kind} of WebAssembly.Module.imports(module)) if(kind==='function') env[name]=helper;
  const instance=new WebAssembly.Instance(module,{env});
  const result=instance.exports.f(0);
  return {result,trace,bytes:Buffer.from(memory.buffer,0,2048)};
}
for(const file of fs.readdirSync(path.join(root,'reference')).sort()) {
  const refBytes=fs.readFileSync(path.join(root,'reference',file));
  const cachedBytes=fs.readFileSync(path.join(root,'cached',file));
  assert.deepEqual(fs.readFileSync(path.join(root,'disabled',file)),refBytes,`${file} cache-off emitter bytes`);
  if(['short-run.wasm','all-fallback.wasm'].includes(file)) assert.deepEqual(cachedBytes,refBytes,`${file} no eligible run`);
  const reference=new WebAssembly.Module(refBytes),cached=new WebAssembly.Module(cachedBytes);
  totalRef+=refBytes.length; totalCached+=cachedBytes.length;
  for(const seed of seeds) for(const mode of modes) {
    const ref=run(reference,seed,mode),actual=run(cached,seed,mode);
    assert.deepEqual(actual,ref,`${file} seed=${seed.toString(16)} mode=${mode}`);
    ++tests;
  }
}
console.log(JSON.stringify({tests,stateBytes:2048,seeds:seeds.length,modes,referenceBytes:totalRef,cachedBytes:totalCached,status:'pass'}));
// Count actual state memory opcodes on the fast branch in these narrow modules.
// No timings: this is a deterministic mechanism check, separate from full games.
function fastStateTraffic(bytes) {
  let p=8;
  function leb() { let n=0,shift=0,b; do {b=bytes[p++]; n|=(b&127)<<shift; shift+=7;}while(b&128); return n>>>0; }
  while(p<bytes.length) {
    const section=bytes[p++],size=leb(),end=p+size;
    if(section!==10) {p=end; continue;}
    assert.equal(leb(),1); leb();
    const groups=leb(); for(let i=0;i<groups;++i) {leb(); ++p;}
    const active=[true]; let loads=0,stores=0;
    while(p<end) {
      const op=bytes[p++];
      if(op===0x04) {++p; active.push(active.at(-1));}
      else if(op===0x05) active[active.length-1]=active.at(-2)&&!active.at(-1);
      else if(op===0x0b) active.pop();
      else if([0x20,0x21,0x22,0x10,0x41].includes(op)) leb();
      else if(op===0x44) p+=8;
      else if([0x28,0x29,0x2b,0x36,0x37,0x39].includes(op)) {
        leb(); const offset=leb();
        if(active.at(-1)&&offset>=256&&offset<768) {
          if(op<0x36) ++loads; else ++stores;
        }
      }
    }
    return {loads,stores};
  }
}
const sample='arith-4-21-alias1.wasm';
const referenceTraffic=fastStateTraffic(fs.readFileSync(path.join(root,'reference',sample)));
const cachedTraffic=fastStateTraffic(fs.readFileSync(path.join(root,'cached',sample)));
assert.deepEqual(referenceTraffic,{loads:32,stores:16});
assert.deepEqual(cachedTraffic,{loads:4,stores:2});
console.log(JSON.stringify({sample,referenceTraffic,cachedTraffic,status:'pass'}));
let aliasTests=0,oldFailures=0;
function aliasRun(module,vector) {
  const memory=new WebAssembly.Memory({initial:1,maximum:1,shared:true});
  const state=new DataView(memory.buffer);
  const scale=vector<3 ? 1/(1<<vector) : -1/(1<<(vector-3));
  for(let r=0;r<32;++r) {
    state.setFloat64(256+16*r,(r%3+1)*scale,true);
    state.setFloat64(264+16*r,(r%4+1)*scale,true);
  }
  state.setUint32(16,8192,true);
  const env={memory};
  for(const {name,kind} of WebAssembly.Module.imports(module)) if(kind==='function') env[name]=()=>{throw new Error('unexpected finite-oracle helper');};
  const result=new WebAssembly.Instance(module,{env}).exports.f(0);
  assert.equal(result,0);
  return Buffer.from(memory.buffer,256,512);
}
for(const file of fs.readdirSync(path.join(root,'reference-aliases')).sort()) {
  const old=new WebAssembly.Module(fs.readFileSync(path.join(root,'reference-aliases',file)));
  const cached=new WebAssembly.Module(fs.readFileSync(path.join(root,'cached-aliases',file)));
  const disabled=new WebAssembly.Module(fs.readFileSync(path.join(root,'disabled-aliases',file)));
  for(let vector=0;vector<6;++vector) {
    const oracle=fs.readFileSync(path.join(root,'oracle',`${file.slice(0,-5)}-${vector}.bin`));
    assert.deepEqual(aliasRun(cached,vector),oracle,`${file} vector${vector}: cached vs actual Interpreter_Paired ordering`);
    assert.deepEqual(aliasRun(disabled,vector),oracle,`${file} vector${vector}: cache-off vs actual Interpreter_Paired ordering`);
    if(!aliasRun(old,vector).equals(oracle)) ++oldFailures;
    ++aliasTests;
  }
}
assert(oldFailures>0,'old emitter must fail independent scalar alias oracle');
console.log(JSON.stringify({aliasTests,oldEmitterFailures:oldFailures,oracle:'actual extracted Interpreter_Paired functions; finite arithmetic shims; FPR ordering only',status:'pass'}));
