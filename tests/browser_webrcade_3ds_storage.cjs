// Run after build.sh, with WEBRCADE_BUILD_ROOT when its WORK directory differs.
// Exercises the patched SDK's Blob API against a backend that rejects Blob writes,
// as WebKit does for the 3DS save ZIP. Legacy records and ordinary values stay readable.
const {webkit}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const source=fs.readFileSync(path.join(process.env.WEBRCADE_BUILD_ROOT||'/tmp/retro-azahar-build','webrcade-app-common/src/storage/storage.js'),'utf8').replace(/^import .*$/mg,'').replace(/^export .*$/mg,'');
 const browser=await webkit.launch({headless:true});try{
 const page=await browser.newPage();const result=await page.evaluate(async source=>{
 const Storage=new Function('LOG',source+'\nreturn Storage;')({info(){},error(){}}),records=new Map();
 const backend={transaction(){const tx={objectStore(){return{put(value,key){if(value instanceof Blob)throw Error('Backend rejects Blob');records.set(key,structuredClone(value));queueMicrotask(()=>tx.oncomplete?.({}));},get(key){const request={result:records.get(key)};queueMicrotask(()=>request.onsuccess?.({}));return request;}};}};return tx;}};
 const storage=new Storage();storage.openIndexedDb=async()=>backend;storage.checkLocalStorageAvailable=()=>false;
 records.set('legacy',new Blob([new Uint8Array([1,2,3])],{type:'application/zip'}));
 await storage.put('new',new Blob([new Uint8Array([17,27,1])],{type:'application/zip'}));
 const old=await storage.get('legacy'),current=await storage.get('new');
 await storage.put('settings',{enabled:true});await storage.put('bytes',new Uint8Array([5,6]));
 return{legacy:[...new Uint8Array(await old.arrayBuffer())],current:[...new Uint8Array(await current.arrayBuffer())],mime:current.type,isBlob:current instanceof Blob,storedAsBytes:records.get('new').bytes instanceof Uint8Array,settings:await storage.get('settings'),bytes:[...await storage.get('bytes')]};
 },source);
 assert.deepEqual(result,{legacy:[1,2,3],current:[17,27,1],mime:'application/zip',isBlob:true,storedAsBytes:true,settings:{enabled:true},bytes:[5,6]});console.log('PASS legacy Blob reads, byte-backed Blob roundtrip, MIME and ordinary settings/byte records');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
