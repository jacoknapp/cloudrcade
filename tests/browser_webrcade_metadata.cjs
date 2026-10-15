// Selected-game metadata teardown/recovery in real engines, with intercepted providers.
// Optional WEBRCADE_TEST_ORIGIN loads the exact staged/live adapter; no account/ROM writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const origin=process.env.WEBRCADE_TEST_ORIGIN||'https://metadata.test';
(async()=>{for(const engine of [chromium,webkit]){
 const browser=await engine.launch({executablePath:engine===chromium?process.env.CHROME:process.env.WEBRCADE_TEST_WEBKIT_PATH,args:engine===chromium?['--no-sandbox']:[]});
 try{
  for(const action of ['hide','disable','unmount','recover']){
   const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage();let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route(origin+'/metadata-fixture',r=>r.fulfill({contentType:'text/html',body:`<html><body><script>
    class Browse{constructor(){this.props={hide:false,disable:false};this.state={menuMode:'apps',searchTerm:'',currentItem:{type:'nes',props:{rom:'/content/fixture.nes'}}};}forceUpdate(){this.componentDidUpdate();}}
    </script><script src="/touch-controls/metadata.js"></script><script>WrcadMetadata.install({Browse});window.browse=new Browse();</script></body></html>`}));
   if(!process.env.WEBRCADE_TEST_ORIGIN)await page.route('**/touch-controls/metadata.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/assets/metadata.js'),'utf8')}));
   await page.route('**/cloud-saves/metadata.php?*',r=>{requests++;if(action==='recover'&&requests===1)return r.abort('failed');return r.fulfill({json:action==='recover'?{available:true,metadata:{description:'Recovered provider'}}:{available:false,pending:true}});});
   await page.goto(origin+'/metadata-fixture');const first=page.waitForRequest(r=>r.url().includes('/metadata.php?'));await page.evaluate(()=>browse.componentDidUpdate());await first;await page.waitForTimeout(150);
   if(action==='recover'){
    await page.waitForFunction(()=>browse.state.currentItem.description==='Recovered provider');assert.equal(requests,2);await page.evaluate(()=>browse.componentDidUpdate());await page.waitForTimeout(500);assert.equal(requests,2);
   }else{
    await page.evaluate(action=>{if(action==='unmount')browse.componentWillUnmount();else{browse.props[action]=true; browse.componentDidUpdate();}},action);
    await page.waitForTimeout(1500);assert.equal(requests,1,'pending retry cancelled on '+action);
   }
   assert.deepEqual(errors,[]);await context.close();console.log('PASS',engine.name(),'metadata',action,'ownership/recovery');
  }
 }finally{await browser.close();}
}})().catch(error=>{console.error(error);process.exitCode=1;});
