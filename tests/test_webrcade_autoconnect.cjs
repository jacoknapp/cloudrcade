const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/cloud/bridge.js'),'utf8');
const key='wrcad.nextcloud.connection.v1',token=JSON.stringify({uid:'alice',login:'alice',password:'fake'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defaults={appName:'CloudRcade',storagePrefix:'wrcad',saveFolder:'CloudRcade',feedUrl:'https://arcade.example.test/content/feeds/combined.json',enable3DS:true,enabled:true,autoRedirect:true,accessAllowed:true,server:'https://nextcloud.test',legacyServer:'https://nextcloud.test',message:'No access has been enabled for Nextcloud. Please enable your own cloud instance.'};
function fixture({saved=null,paused=false,attempted=false,offline=false,iframe=false,reply,config=defaults,cachedConfig=null}={}){
 const local=new Map(saved?[[key,saved]]:[]),session=new Map(),calls=[],locations=[];
 if(paused)local.set(key+'.paused','true');if(attempted)session.set(key+'.attempt','true');
 if(cachedConfig)local.set('webrcade.runtime.config.v1',JSON.stringify(cachedConfig));
 const storage=m=>({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});
 const win={WrcadCloudConfig:config,navigator:{onLine:!offline},location:{href:'https://games.test/play/'},addEventListener(){}};
 win.location.assign=url=>locations.push(url);win.top=iframe?{}:win;
 const notices=[];const document={readyState:'complete',getElementById:()=>null,createTextNode:text=>text,createElement:()=>({style:{},setAttribute(){},append(v){if(typeof v==='string')notices.push(v)}}),head:{append(){}},body:{append(){}}};
 const fetch=async(url,options)=>{calls.push(url);return reply?reply(url,options,local):Response.json({csrf:'test'});};
 const runtime=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/touch/cloud/runtime.js'),'utf8');
 const scope={window:win,navigator:win.navigator,localStorage:storage(local),sessionStorage:storage(session),
  location:{origin:'https://games.test'},document,fetch,AbortSignal,URL,Promise,Blob,TextEncoder,TextDecoder,btoa,unescape,encodeURIComponent};
 vm.runInNewContext(runtime,scope);vm.runInNewContext(source,scope);
 const settings={isCloudStorageEnabled:()=>false,getDbToken:()=> 'native-token',setDbToken:t=>settings.token=t,load:async()=>settings.loaded=true};
 const native={uploadFile(){},checkLinkResult(){},link(){},getRedirectUri(){return null}};
 const link=native.link;
 win.WrcadCloud.install({settings,storage:native});
 return {win,settings,native,link,local,session,calls,locations,notices};
}
(async()=>{
 for(const options of [{offline:true},{iframe:true},{paused:true},{attempted:true}]){
  const f=fixture(options);await f.settings.load();assert.equal(f.calls.length,0);assert.equal(f.locations.length,0);
 }
 let f=fixture({config:{...defaults,autoRedirect:false}});await f.settings.load();assert.equal(f.calls.length,0);
 f.win.WrcadCloud.connect();assert(new URL(f.locations[0]).searchParams.has('connect'),'manual Link remains active with auto redirect off');
 for(const config of [null,{...defaults,enabled:false},{...defaults,accessAllowed:false}]){
  f=fixture({config});await f.settings.load();assert.equal(f.locations.length,0);assert.equal(f.calls.length,0);
 }
 f=fixture({config:{...defaults,enabled:false}});await f.settings.load();f.win.WrcadCloud.connect();assert.equal(f.locations.length,0);assert.equal(f.notices[0],defaults.message);
 f=fixture({saved:token,config:{...defaults,autoRedirect:false,server:'https://another-cloud.test'}});await f.settings.load();assert.equal(f.win.WrcadCloud.controlsAccount(),null);
 f=fixture({config:null,cachedConfig:{...defaults,autoRedirect:false},saved:token,offline:true});await f.settings.load();assert.equal(f.win.WrcadCloud.controlsAccount(),'alice');assert.equal(f.calls.length,0);
 f=fixture({saved:token,reply:url=>url.includes('status')?Response.json({csrf:'test'}):Response.json({code:'access_denied',error:defaults.message},{status:403})});
 await f.settings.load();assert.equal(f.notices[0],defaults.message);assert.equal(f.win.WrcadCloud.controlsAccount(),null);assert.equal(f.local.get(key),token);
 console.log('PASS enabled/auto redirect independent, manual Link, unavailable access and server credential scoping');
 f=fixture();let loaded=false;f.settings.load().then(()=>loaded=true);await tick();await tick();
 assert.equal(loaded,false);assert.equal(f.locations.length,1);assert.equal(f.session.get(key+'.attempt'),'true');
 assert.equal(f.settings.isCloudStorageEnabled(),false);assert.equal(f.settings.getDbToken(),'native-token');assert.equal(f.native.link,f.link);
 f=fixture({saved:token});await f.settings.load();assert(f.calls[1].includes('verify'));assert.equal(f.locations.length,0);
 for(const status of [500,403]){
  f=fixture({saved:token,reply:url=>url.includes('status')?Response.json({csrf:'test'}):new Response('',{status})});
  await f.settings.load();assert.equal(f.local.get(key),token);assert.equal(f.locations.length,0);
 }
 f=fixture({reply:()=>Promise.reject(new Error('offline'))});await f.settings.load();assert.equal(f.locations.length,0);
 f=fixture({saved:token,reply:(url,options,local)=>{
  if(url.includes('status'))return Response.json({csrf:'test'});
  local.set(key,JSON.stringify({uid:'bob',login:'bob',password:'new-fake'}));return new Response('',{status:401});
 }});await f.settings.load();assert.equal(JSON.parse(f.local.get(key)).uid,'bob');assert.equal(f.locations.length,0);
 f=fixture({reply:(url,options,local)=>{local.set(key+'.paused','true');return Response.json({csrf:'test'});}});
 await f.settings.load();assert.equal(f.locations.length,0);
 // The save adapter offers one effective provider; its chooser replaces the
 // inherited Dropbox controls which did not route saves through this fork.
 const react={createRef:()=>({current:null}),cloneElement:(element,props,...children)=>({
  ...element,props:{...element.props,...props,...(children.length?{children:children.length===1?children[0]:children}:{})}})};
 const element=(children,props={})=>({props:{...props,children}});
 const row=(label,content)=>element([element(label),element(content)]);
 class CloudTab {
  constructor(enabled){this.props={values:{cloudStorage:enabled}};this.cloudStorageRef={};this.dropboxRef={};this.disableSavesRef={};}
  render(){return [row('Enabled',element(null,{checked:this.props.values.cloudStorage})),this.props.values.cloudStorage?
   [row('Dropbox',element(element(null,{label:'Link'}))),row('Status',element('Unlinked')),row('Disable saves',element(null,{checked:false}))]:null];}
 }
 let available=false;
 f.win.WrcadCloud.installUI({react,CloudStorageTab:CloudTab,storage:{getRedirectUri:()=>available?'https://supported.test/dropbox/':null}});
 for (const nativeEnabled of [false,true]) {
  available=nativeEnabled;
  const ui=new CloudTab(nativeEnabled),rows=ui.render();assert.equal(rows.length,4);
  assert.equal(rows[0].props.children[0].props.children,'Nextcloud');
  assert.equal(rows[3].props.children[0].props.children,'Save destination');
  const chooser=rows[3].props.children[1].props.children.props.children;
  assert.equal(chooser.props.label,'Choose storage');chooser.props.onClick();
  assert.equal(new URL(f.locations.at(-1)).pathname,'/cloud-saves/');
 }
 console.log('PASS provider chooser and shared disable-saves control independent of obsolete upstream Dropbox switch');
 console.log('PASS automatic startup gate, offline/back/disconnect guards, native provider isolation and late expired-token account-switch protection');
})().catch(e=>{console.error(e);process.exitCode=1});
