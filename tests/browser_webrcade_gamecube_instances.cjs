// Exercise the source shipped with the qualified native artifact in both engines.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const archive=process.env.GAMECUBE_SOURCE_ARCHIVE;
if(!archive)throw Error('Supply GAMECUBE_SOURCE_ARCHIVE from a qualified GameCube package');
const helper=execFileSync('python3',['-c',"import sys,tarfile; t=tarfile.open(sys.argv[1]); print(t.extractfile('vendor/dolphin/Source/Core/Core/PowerPC/CachedInterpreter/WasmInstanceCache.js').read().decode())",archive],{encoding:'utf8'});
(async()=>{
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch(engine===webkit?{executablePath:process.env.WEBRCADE_TEST_WEBKIT_PATH}:{args:['--no-sandbox']});
  try{
   const page=await browser.newPage();
   const result=await page.evaluate(helper=>{
    const bytes=new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,5,1,1,102,0,0,10,6,1,4,0,65,42,11]);
    const fn=new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.f;
    const Module={},table=new WebAssembly.Table({element:'anyfunc',initial:2});
    table.set(0,fn);table.set(1,fn);new Function('Module','wasmTable',helper)(Module,table);
    const cache=Module._dolphinWasmInstances;
    for(let i=0;i<4096;i++)cache.insert('block-'+i,[0,1],fn);
    const length=table.length,hot=cache.get('block-1',[0,1]),cold=cache.get('block-0',[0,1]);
    cache.retire(cold);cache.retire(cold);cache.retire(0);
    const selective=table.get(cold)===null&&cache.get('block-0',[0,1])===undefined&&
      table.get(hot)()===42&&cache.insert('cold-replacement',[0,1],fn)===cold&&table.length===length;
    cache.reset();
    let retained=0;for(let i=2;i<length;i++)if(table.get(i)!==null)retained++;
    const empty=cache.size()===0;
    for(let i=0;i<4096;i++)cache.insert('new-block-'+i,[0,1],fn);
    const reused=table.length===length&&table.get(cache.get('new-block-0',[0,1]))()===42;
    cache.reset();let secondRetained=0;for(let i=2;i<length;i++)if(table.get(i)!==null)secondRetained++;
    return {selective,retained,secondRetained,empty,reused,helperPreserved:table.get(0)()===42&&table.get(1)()===42};
   },helper);
   assert.deepEqual(result,{selective:true,retained:0,secondRetained:0,empty:true,reused:true,helperPreserved:true});
   console.log('PASS',engine.name(),'shipped native cache releases retired table functions, preserves helpers and reuses handles',JSON.stringify(result));
  }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
