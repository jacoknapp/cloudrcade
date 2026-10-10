// Runtime BIOS loading: synthetic keys only, no network/account/storage access.
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('deploy/webrcade/retro-azahar/app/src/emulator/systemkeys.js','utf8').replace('export async function','async function');
const context={TextDecoder,TextEncoder,Uint8Array};vm.createContext(context);vm.runInContext(source,context);
const install=context.installSystemKeys;
(async()=>{
 const writes=new Map(),dirs=[];
 const FS={mkdir:p=>dirs.push(p),writeFile:(p,b)=>writes.set(p,new TextDecoder().decode(b))};
 assert.equal(await install(FS,'/save/Azahar/sysdata',{},()=>{throw Error('unexpected fetch')}),false);
 let options;
 const response=text=>async(url,args)=>{assert.equal(url,'/cloud-saves/3ds-keys.php');options=args;return {ok:true,arrayBuffer:async()=>new TextEncoder().encode(text).buffer}};
 const config={n3dsKeysUrl:'/cloud-saves/3ds-keys.php'};
 const fake='slot0x2CKeyX = '+ 'ab'.repeat(16);
 await install(FS,'/save/Azahar/sysdata',config,response('# test\r\n'+fake+'\r\n'));
 assert.equal(writes.get('/save/Azahar/sysdata/keys.txt'),':AES\n'+fake.replace(' = ','=')+'\n');
 assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
 assert(dirs.includes('/save/Azahar/sysdata'));
 await install(FS,'/save/Azahar/sysdata',config,response(':AES\n'+fake+'\n:RSA\nticketWrapExp=010001'));
 assert(writes.get('/save/Azahar/sysdata/keys.txt').includes(':RSA'));
 for(const bad of ['',':AES','not-a-file','slot0x2CKeyX=wrong','secret content without delimiter','slot0x2CKeyX=abc','x=00\nsecret\u0000data']) {
   await assert.rejects(install(FS,'/save/Azahar/sysdata',config,response(bad)),/Invalid 3DS key file/);
 }
 await assert.rejects(install(FS,'/save/Azahar/sysdata',config,async()=>({ok:false})),/unavailable/);
 await assert.rejects(install(FS,'/save/Azahar/sysdata',config,async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(262145).buffer})),/size/);
 await assert.rejects(install(FS,'/save/Azahar/sysdata',config,async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([255]).buffer})),/text file/);
 console.log('PASS optional runtime Citra/Azahar text keys, no-store same-origin fetch, normalization and invalid/binary rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
