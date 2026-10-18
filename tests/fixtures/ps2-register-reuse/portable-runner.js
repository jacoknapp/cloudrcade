// Standalone actual-generator corpus runner. Plain JS; no Node/DOM dependencies.
async function runPortableCorpus(corpus) {
 function check(value,message){if(!value)throw Error(message);}
 function decode(text){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];let value=0,bits=0;
  for(const ch of text){if(ch==='=')break;const n=alphabet.indexOf(ch);if(n<0)continue;value=(value<<6)|n;bits+=6;if(bits>=8){bits-=8;out.push((value>>>bits)&255);}}
  return new Uint8Array(out);
 }
 function hex(array){let out='';for(const b of array)out+=b.toString(16).padStart(2,'0');return out;}
 function same(a,b){if(a.length!==b.length)return false;for(let k=0;k<a.length;k++)if(a[k]!==b[k])return false;return true;}
 function section(id,body){check(body.length<128,'bridge section size');return [id,body.length,...body];}
 const memory=new WebAssembly.Memory({initial:corpus.memoryPages,maximum:32768,shared:true});
 const bytes=new Uint8Array(memory.buffer),view=new DataView(memory.buffer),instances={baseline:{},candidate:{}};
 let observations=[],reentry=null;
 function observe(ctx,src,out){
  ctx>>>=0;src>>>=0;out>>>=0;
  observations.push({ctx,src,out,source:hex(bytes.subarray(ctx+src,ctx+src+16)),stored:hex(bytes.subarray(ctx+out,ctx+out+16))});
  if(reentry)reentry(ctx);else view.setUint32(ctx+src,0xdedcab89,true);
 }
 const bridgeBytes=new Uint8Array([0,97,115,109,1,0,0,0,
  ...section(1,[1,0x60,3,0x7f,0x7f,0x7f,0]),
  ...section(2,[1,3,101,110,118,1,102,0,0]),
  ...section(7,[1,1,102,0,0])]);
 const bridge=new WebAssembly.Instance(new WebAssembly.Module(bridgeBytes),{env:{f:observe}}).exports.f;
 const table=new WebAssembly.Table({initial:32,element:'anyfunc'});table.set(0,bridge);
 const disabled={};let invalid=0,defaultIdentical=0,policyToggles=0;
 for(const kernel of corpus.kernels){
  const encoded={baseline:decode(kernel.baseline),candidate:decode(kernel.candidate)};
  if(kernel.kind===0||kernel.kind===2){check(same(encoded.baseline,encoded.candidate),'default/disabled byte identity '+kernel.id);defaultIdentical++;}
  for(const variant of ['baseline','candidate']){
   let error=null;
   try{instances[variant][kernel.id]=new WebAssembly.Instance(new WebAssembly.Module(encoded[variant]),{env:{memory,fctTable:table}}).exports.codeGenFunc;}catch(e){error=e.constructor.name;}
   check(error===kernel.error,'validation '+kernel.id+' '+variant+' '+error);
  }
  if(kernel.error){check(kernel.mode===12&&corpus.knownEncodingFailureOffsets.includes(kernel.arg),'unclassified invalid module');invalid++;}
  if(kernel.disabled){disabled[kernel.id]=new WebAssembly.Instance(new WebAssembly.Module(decode(kernel.disabled)),{env:{memory,fctTable:table}}).exports.codeGenFunc;policyToggles++;}
 }
 let cases=0,traps=0,helperCalls=0,reentries=0,knownFullMaskOracleFailures=0;
 for(const test of corpus.cases){
  const initial=new Uint8Array(bytes.length);initial.fill(corpus.canary);initial.set(decode(test.input),test.base);
  const expected=new Uint8Array(bytes.length);expected.fill(corpus.canary);expected.set(decode(test.expected),test.base);
  for(const variant of ['baseline','candidate']){
   bytes.set(initial);observations=[];let error=null;
   reentry=test.reentry===null?null:instances[variant][test.reentry];
   try{instances[variant][test.kernel](test.base);}catch(e){error=e.constructor.name;}
   reentry=null;
   check(error===test.trap,'trap '+test.kernel+' '+variant+' '+error);
   check(same(bytes,expected),'full context/raw bytes/canaries '+test.kernel+' '+variant);
   check(JSON.stringify(observations)===JSON.stringify(test.calls),'helper/store observations '+test.kernel+' '+variant);
  }
  if(disabled[test.kernel]){
   bytes.set(initial);observations=[];disabled[test.kernel](test.base);
   check(same(bytes,expected),'same backend disabled execution '+test.kernel);
  }
  if(test.trap)traps++;if(test.calls.length)helperCalls++;if(test.reentry!==null)reentries++;
  if(test.knownFullMaskOracleFailure)knownFullMaskOracleFailures++;
  cases++;
 }
 check(invalid===2&&traps===3&&helperCalls>0&&reentries>0&&policyToggles===4,'missing fixed corpus controls');
 return {kernels:corpus.kernels.length,cases,traps,helperCalls,reentries,defaultOrDisabledIdentical:defaultIdentical,policyToggles,knownBaselineEncodingFailures:invalid,knownBaselineFullMaskOracleFailures:knownFullMaskOracleFailures,layout:corpus.layout,fullContextRawBytesAndCanaries:true,synchronizationUnchanged:true,performanceClaim:false};
}
if(typeof module!=='undefined')module.exports={runPortableCorpus};
