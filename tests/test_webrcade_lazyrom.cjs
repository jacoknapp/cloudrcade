const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-azahar/app/src/emulator/lazyrom.js'),'utf8');
 const {LazyRom}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const chunk=2*1024*1024, size=3708281856, rom=new LazyRom('https://example.invalid/ultra-moon.cia',size),requests=[];
 // Deterministic virtual multi-GB file: no ROMs or large file allocations required.
 rom.fetchChunk=index=>{requests.push(index);const data=new Uint8Array(Math.min(chunk,size-index*chunk));data.fill(index%251);return data;};
 const buffer=new Uint8Array(12).fill(99);assert.equal(rom.read(buffer,2,8,chunk-3),8);assert.deepEqual([...buffer],[99,99,0,0,0,1,1,1,1,1,99,99]);
 assert.equal(rom.read(buffer,0,4,2**31+7),4);assert.deepEqual([...buffer.slice(0,4)],Array(4).fill(1024%251),'offsets above 2 GiB must not wrap');
 for(let index=2;index<20;index++)rom.getChunk(index);
 assert(rom.chunks.size<=8,'stream cache must stay within 16 MiB');const before=requests.length;rom.getChunk(19);assert.equal(requests.length,before);rom.getChunk(0);assert.equal(requests.length,before+1,'evicted data must be fetched again');
 assert.equal(rom.read(buffer,0,12,size-3),3);assert.equal(rom.read(buffer,0,12,size),0);
 const failing=new LazyRom('https://example.invalid/game.cia',100);
 global.XMLHttpRequest=class{open(){}setRequestHeader(){}overrideMimeType(){}send(){this.status=200;this.responseText='';}};
 assert.throws(()=>failing.fetchChunk(0),/Unexpected status 200/,'a full-file response must never replace a range');
 // A chunk whose first bytes form a byte-order mark comes back mangled; it is refetched from earlier bytes.
 const marked=new LazyRom('https://example.invalid/game.cia',chunk+64),ranges=[];
 global.XMLHttpRequest=class{open(){}overrideMimeType(){}setRequestHeader(name,value){[this.first,this.last]=value.slice(6).split('-').map(Number)}
  send(){ranges.push(this.first);this.status=206;const length=this.last-this.first+1;
   // Bytes at chunk and chunk+1 are FE FF; one byte earlier is FF, forming FF FE.
   this.responseText=this.first===chunk||this.first===chunk-1?'':String.fromCharCode(...Array.from({length},(_,i)=>(this.first+i)%200));}};
 assert.deepEqual([...marked.fetchChunk(1).slice(0,3)],[chunk%200,(chunk+1)%200,(chunk+2)%200]);assert.deepEqual(ranges,[chunk,chunk-1,chunk-2]);
 const stuck=new LazyRom('https://example.invalid/game.cia',64);global.XMLHttpRequest=class{open(){}overrideMimeType(){}setRequestHeader(){}send(){this.status=206;this.responseText='x'}};
 assert.throws(()=>stuck.fetchChunk(0),/Short read/);
 console.log('PASS cross-chunk reads, multi-GB offsets, 16 MiB LRU bound, refetch, EOF, range enforcement and byte-order-mark chunks');
})().catch(e=>{console.error(e);process.exitCode=1});
