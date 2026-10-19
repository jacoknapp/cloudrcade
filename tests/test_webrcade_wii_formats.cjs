const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'../deploy/webrcade/retro-wii');
 const {inspectDisc}=await import(pathToFileURL(path.join(root,'disc.mjs')));
 // Transport uses the unchanged shared validator, packaged beside it by prepare.
 const transportSource=require('node:fs').readFileSync(path.join(root,'transport.mjs'),'utf8')
  .replace("'./disc.mjs'",JSON.stringify(pathToFileURL(path.join(root,'disc.mjs')).href))
  .replace("'./range-fetch.mjs'",JSON.stringify(pathToFileURL(path.join(root,'../retro-dolphin/app/range-fetch.mjs')).href));
 const {remoteDisc}=await import('data:text/javascript;base64,'+Buffer.from(transportSource).toString('base64'));
 function fixture(format,size=128*1024**2){
  const block=2*1024**2, header=Buffer.alloc(0x100);header.write('TEST01');header.writeUInt32BE(0x5d1c9ea3,24);
  const meta=Buffer.alloc(0x8000);let offset=0;
  if(format==='wbfs'){
   meta.write('WBFS');meta.writeUInt32BE(size/512,4);meta[8]=9;meta[9]=21;meta[12]=1;
   header.copy(meta,512);meta.writeUInt16BE(3,512+256);offset=3*block;
  }else if(format==='ciso'){
   meta.write('CISO');meta.writeUInt32LE(block,4);meta.fill(1,8,8+(size-0x8000)/block);offset=0x8000;
  }
  const reads=[];
  const slice=(start,end)=>{
   reads.push([start,end]);assert(end-start<=1024**2,'metadata reads stay bounded');
   const bytes=Buffer.alloc(end-start);
   function copy(data,at){const first=Math.max(start,at),last=Math.min(end,at+data.length);if(last>first)data.copy(bytes,first-start,first-at,last-at);}
   if(format!=='iso')copy(meta,0);copy(header,offset);
   return new Blob([bytes]);
  };
  return {file:{name:'Test.'+format,size,slice},reads,meta,header};
 }
 for(const [format,size] of [['iso',5*1024**3],['wbfs',6*1024**3],['ciso',0x8000+4096*2*1024**2]]){
  const f=fixture(format,size),disc=await inspectDisc(f.file);
  assert.equal(disc.gameId,'TEST01');assert.equal(disc.size,size);assert.equal(disc.format,format);
  assert(f.reads.reduce((sum,[a,b])=>sum+b-a,0)<1024**2);
  const requests=[];
  const fetcher=async(url,{headers,signal})=>{
   assert(!signal.aborted);const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(headers.Range).map(Number);requests.push([a,b]);
   if(requests.length>1)assert.equal(headers['If-Range'],'"fixture-v1"');
   return new Response(await f.file.slice(a,b+1).arrayBuffer(),{status:206,headers:{'Content-Range':`bytes ${a}-${b}/${size}`,ETag:'"fixture-v1"'}});
  };
  const remote=await remoteDisc('https://example.test/Test.'+format,{fetcher});
  assert(remote.remote);assert.deepEqual(remote.disc,disc);assert.equal(remote.size,size);assert(requests.every(([a,b])=>b-a<1024**2));
 }
 const badWbfs=fixture('wbfs');badWbfs.meta.writeUInt16BE(0xffff,768);
 await assert.rejects(inspectDisc(badWbfs.file),/outside/);
 const split=fixture('wbfs');split.file.size-=512;
 await assert.rejects(inspectDisc(split.file),/split WBFS/);
 const multi=fixture('wbfs');multi.meta[13]=1;
 await assert.rejects(inspectDisc(multi.file),/one game/);
 const badCiso=fixture('ciso',0x8000+64*2*1024**2);badCiso.meta[8]=2;
 await assert.rejects(inspectDisc(badCiso.file),/Invalid Wii CISO/);
 const shortCiso=fixture('ciso',0x8000+64*2*1024**2);shortCiso.file.size--;
 await assert.rejects(inspectDisc(shortCiso.file),/Truncated Wii CISO/);
 const cube=fixture('wbfs');cube.header.writeUInt32BE(0,24);cube.header.writeUInt32BE(0xc2339f3d,28);
 await assert.rejects(inspectDisc(cube.file),/no Wii disc header/);
 await assert.rejects(inspectDisc({name:'PSP.cso',size:64}),/ISO, WBFS or CISO/);
 await assert.rejects(inspectDisc({name:'short.iso',size:4}),/Truncated/);
 let cancelled=false;
 await assert.rejects(remoteDisc('https://example.test/game.wbfs',{fetcher:async()=>({status:200,headers:new Headers(),body:{cancel:async()=>{cancelled=true;}}})}),/exact HTTP byte ranges/);assert(cancelled);
 const f=fixture('ciso',0x8000+64*2*1024**2);let request=0;
 await assert.rejects(remoteDisc('https://example.test/game.ciso',{fetcher:async(url,{headers})=>{
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(headers.Range).map(Number);
  return new Response(await f.file.slice(a,b+1).arrayBuffer(),{status:206,headers:{'Content-Range':`bytes ${a}-${b}/${f.file.size}`,ETag:++request===1?'"old"':'"new"'}});
 }}),/disc changed/);
 console.log('PASS Wii ISO/WBFS/CISO bounded metadata and range streaming above4GiB, mapped WBFS header, malformed/truncated/split/platform rejection, changed-ETag and full-response rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
