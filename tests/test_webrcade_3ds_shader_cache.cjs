/* Merging of the 3DS shader program cache between a browser and the cloud. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-azahar/app/src/emulator/shadercache.js'),'utf8');
 const {mergeShaderCaches}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const stamp=name=>{const b=Buffer.alloc(27);b.write(name);return b};
 const S=(hash,text)=>{const b=Buffer.alloc(17+text.length);b[0]=0x53;b.writeBigUInt64LE(BigInt(hash),1);b.writeUInt32LE(0x8B30,9);b.writeUInt32LE(text.length,13);b.write(text,17);return b};
 const P=(id,vs,fsh)=>{const b=Buffer.alloc(25);b[0]=0x50;b.writeBigUInt64LE(BigInt(id),1);b.writeBigUInt64LE(BigInt(vs),9);b.writeBigUInt64LE(BigInt(fsh),17);return b};
 const file=(name,...parts)=>new Uint8Array(Buffer.concat([stamp(name),...parts]));
 const mine=file('WRCP1 build-a',S(1,'vertex one'),S(2,'fragment two'),P(10,1,2));
 const other=file('WRCP1 build-a',S(2,'fragment two'),S(3,'fragment three'),P(11,1,3),P(10,1,2));
 const merged=mergeShaderCaches(mine,other);
 assert.deepEqual(Buffer.from(merged),Buffer.concat([stamp('WRCP1 build-a'),S(1,'vertex one'),S(2,'fragment two'),S(3,'fragment three'),P(10,1,2),P(11,1,3)]),'union, shaders before pairs, no duplicates');
 assert.deepEqual(mergeShaderCaches(merged,other),merged,'merging again changes nothing');
 assert.equal(mergeShaderCaches(mine,file('WRCP1 build-b',S(9,'x'))),mine,'a copy from another core build is dropped');
 assert.equal(mergeShaderCaches(mine,null),mine);assert.equal(mergeShaderCaches(null,other),other);assert.equal(mergeShaderCaches(null,null),null);
 const cut=other.subarray(0,other.length-10);
 assert.deepEqual(Buffer.from(mergeShaderCaches(mine,cut)),Buffer.concat([stamp('WRCP1 build-a'),S(1,'vertex one'),S(2,'fragment two'),S(3,'fragment three'),P(10,1,2),P(11,1,3)]),'a truncated last record is ignored');
 assert.equal(mergeShaderCaches(new Uint8Array(5),other),other,'a file without a stamp counts as none');
 console.log('PASS shader cache union, idempotence, other-build and truncated copies');
})().catch(e=>{console.error(e);process.exitCode=1});
