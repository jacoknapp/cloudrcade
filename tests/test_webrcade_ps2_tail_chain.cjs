/* Isolated Wasm contract prototype, NOT a Play translator or product feature.
 * Both variants dispatch inside Wasm. Node 22+, no toolchain/GPU/dependencies.
 * Generates distinct guest instances sharing mutable table/memory; compares
 * all guest-visible words after quotas, delay slots, exceptions and table reuse.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const u=n=>{const a=[];do{let b=n&127;n>>>=7;a.push(b|(n?128:0));}while(n);return a;};
const s=n=>{const a=[];let more=true;while(more){let b=n&127;n>>=7;more=!((n===0&&!(b&64))||(n===-1&&(b&64)));a.push(b|(more?128:0));}return a;};
const str=x=>[...u(x.length),...Buffer.from(x)];
const vec=xs=>[...u(xs.length),...xs.flat()];
const sec=(id,b)=>[id,...u(b.length),...b];
const get=n=>[0x20,...u(n)],c=n=>[0x41,...s(n)];
const load=offset=>[...get(0),0x28,2,...u(offset)];
const store=(offset,value)=>[...get(0),...value,0x36,2,...u(offset)];
const add=(a,b)=>[...a,...b,0x6a],sub=(a,b)=>[...a,...b,0x6b];
const eq=(a,b)=>[...a,...b,0x46],ne=(a,b)=>[...a,...b,0x47];
const iff=(cond,body,other)=>[...cond,0x04,0x40,...body,...(other?[0x05,...other]:[]),0x0b];
const retIf=cond=>iff(cond,[0x0f]);
const PC=[0xffc,0x1004];
const O={quota:0,pc:4,delay:8,exception:12,count:16,value:20,budget:24,epoch:28,entries:32};
const edge=i=>64+i*16,gen=slot=>128+slot*4,lookup=i=>256+i*4;
function moduleBytes(body,{event=false,locals=0}={}){
 const types=[[0x60,1,0x7f,0],[0x60,2,0x7f,0x7f,0]];
 const imports=[[...str('env'),...str('table'),1,0x70,0,4],[...str('env'),...str('memory'),2,0,1]];
 if(event)imports.push([...str('env'),...str('event'),0,1]);
 const code=[...vec(locals?[[...u(locals),0x7f]]:[]),...body,0x0b];
 return Uint8Array.from([0,97,115,109,1,0,0,0,...sec(1,vec(types)),...sec(2,vec(imports)),...sec(3,vec([[0]])),...sec(7,vec([[...str('run'),0,event?1:0]])),...sec(10,vec([[...u(code.length),...code]]))]);
}
function guest(id,{tail=false,event=false,value=id+1,cost=id+2}={}){
 let b=[...store(O.count,add(load(O.count),c(1))),...store(O.value,add(load(O.value),c(value)))];
 if(event)b.push(...get(0),...c(id),0x10,0);
 b.push(...store(O.quota,sub(load(O.quota),c(cost))));
 b.push(...iff([...load(O.quota),...c(0),0x4c],store(O.exception,[...load(O.exception),...c(1),0x72])));
 b.push(...iff(ne(load(O.delay),c(-1)),[...store(O.pc,load(O.delay)),...store(O.delay,c(-1))],store(O.pc,c(PC[1-id]))));
 if(tail){
  b.push(...retIf(ne(load(O.exception),c(0))),...retIf([...load(O.budget),...c(0),0x4c]));
  b.push(...retIf(ne(load(O.pc),load(edge(id)+8))));
  b.push(...load(edge(id)),0x21,1); // mutable slot; never bake a recyclable handle
  b.push(...retIf(eq(get(1),c(-1))));
  b.push(...retIf(ne(load(edge(id)+12),load(O.epoch))));
  const actualGen=[...get(0),...get(1),...c(4),0x6c,...c(128),0x6a,0x6a,0x28,2,0];
  b.push(...retIf(ne(load(edge(id)+4),actualGen)));
  b.push(...store(O.budget,sub(load(O.budget),c(1))));
  b.push(...get(0),...get(1),0x13,0,0); // return_call_indirect type0 table0
 }
 return moduleBytes(b,{event,locals:tail?1:0});
}
function dispatcher(){
 // Same existing Wasm lookup/call loop in both modes. Return on every exception.
 const slot=[...get(0),...c(256),...load(O.pc),...c(PC[1]),0x46,...c(4),0x6c,0x6a,0x6a,0x28,2,0];
 return moduleBytes([0x02,0x40,0x03,0x40,...load(O.exception),0x0d,1,
  ...store(O.entries,add(load(O.entries),c(1))),...store(O.budget,c(63)),
  ...get(0),...slot,0x11,0,0,0x0c,0,0x0b,0x0b]);
}
const supported=WebAssembly.validate(guest(0,{tail:true}));
assert(supported,'Node must support tail calls to run the candidate fixture');
const instantiate=(bytes,env)=>new WebAssembly.Instance(new WebAssembly.Module(bytes),{env}).exports.run;
function run({tail,quota=10000,delay=-1,eventAt=0,action='',cold=false,events=true}){
 const memory=new WebAssembly.Memory({initial:1}),table=new WebAssembly.Table({initial:4,element:'anyfunc'});
 const words=new Int32Array(memory.buffer),at=offset=>offset/4;
 words[at(O.quota)]=quota;words[at(O.pc)]=PC[0];words[at(O.delay)]=delay;words[at(O.epoch)]=1;
 const env={memory,table,event(ctx,id){
  if(words[at(O.count)]!==eventAt)return;
  const target=1-id;
  if(action==='interrupt'||action==='exception'||action==='breakpoint')words[at(O.exception)]|=action==='interrupt'?2:action==='exception'?4:8;
  if(action==='overlay'){
   // Invalidation/FlushCache clears an edge BEFORE slot reuse; keep generation
   // stale deliberately to verify the second safety guard independently.
   words[at(gen(target))]++;
   table.set(target,instantiate(guest(target,{tail,event:events,value:17}),env));
  }
  if(action==='generation-reset')words[at(O.epoch)]++;
  if(action==='null-edge')words[at(edge(id))]=-1;
  if(action==='growth')table.grow(16);
 }};
 for(let i=0;i<2;i++){
  words[at(gen(i))]=1;words[at(lookup(i))]=i;
  words[at(edge(i))]=cold?-1:1-i;words[at(edge(i)+4)]=1;
  words[at(edge(i)+8)]=PC[1-i];words[at(edge(i)+12)]=1;
  table.set(i,instantiate(guest(i,{tail,event:events}),env));
 }
 instantiate(dispatcher(),env)(0);
 return {state:Array.from(words.subarray(0,6)),entries:words[at(O.entries)],moduleBytes:guest(0,{tail,event:events}).length};
}
const cases=[];
for(const quota of [1,2,3,4,5,63,64,65,127,1024,1000000])cases.push({quota});
for(const delay of PC)cases.push({delay});
for(const action of ['interrupt','exception','breakpoint','overlay','generation-reset','null-edge','growth'])
 for(const eventAt of [1,2,31,64,129])cases.push({action,eventAt});
cases.push({cold:true});
for(const test of cases){
 const base=run({...test,tail:false}),candidate=run({...test,tail:true});
 assert.deepEqual(candidate.state,base.state,JSON.stringify(test));
 assert(candidate.entries<=base.entries);
}
// Unsupported engines select ordinary bytecode before compilation (no tail op).
function chooseTail(requested,validate=WebAssembly.validate){return requested&&validate(guest(0,{tail:true}));}
assert.equal(chooseTail(true,()=>false),false);assert.equal(chooseTail(false),false);
assert(WebAssembly.validate(guest(0,{tail:false})));
const baseline=run({tail:false,quota:1000000,events:false}),candidate=run({tail:true,quota:1000000,events:false});
assert.deepEqual(candidate.state,baseline.state);assert.equal(baseline.entries,400000);assert.equal(candidate.entries,6250);
const result={fixture:'synthetic cross-module Wasm contract, not Play/game performance',cases:cases.length,guestBlocks:baseline.entries,baselineExecutorEntries:baseline.entries,tailExecutorEntries:candidate.entries,maximumBlocksPerEntry:64,baselineBytes:baseline.moduleBytes,candidateBytes:candidate.moduleBytes,featureFallback:true};
if(process.env.PS2_TAIL_FIXTURE_WASM)fs.writeFileSync(process.env.PS2_TAIL_FIXTURE_WASM,guest(0,{tail:true}));
console.log(JSON.stringify(result,null,2));
