const ROOT='/cloudrcade/cards';
export const validCard=name=>/^mc[01]\/(?:[^/\x00-\x1f]+\/)*[^/\x00-\x1f]+$/.test(name)&&!name.split('/').some(part=>part==='.'||part==='..');
export class Ps2Saves {
 constructor(module,props,format,onStatus){this.module=module;this.props=props;this.format=format;this.onStatus=onStatus;this.queue=Promise.resolve();this.listeners=new Set();this.status='';this.busy=false;this.retry=false;}
 report(text,busy=false){this.status=text;this.busy=busy;this.onStatus(text);for(const listener of this.listeners)listener();}
 serialize(action){const next=this.queue.then(action);this.queue=next.catch(()=>{});return next;}
 async initialize(id){
  const sdk=await import('./save-sdk.mjs');
  if(!globalThis.WrcadCloud)throw new Error('CloudRcade save bridge did not load.');
  WrcadCloud.install(sdk);await sdk.settings.load();
  this.manager=new sdk.SaveManager({getTitle:()=>this.props.title||'PlayStation 2',getProps:()=>this.props},text=>{this.lastCloudError=text;this.report(text);});
  this.manager.cloudRequestTimeoutMs=60000;
  this.manager.cloudUploadTimeoutMs=180000;
  this.manager.createZip=sdk.createSaveZip;this.manager.getFiles=blob=>sdk.readSaveZip(blob);
  this.manager.getSaveMetadata=blob=>sdk.readSaveZip(blob,true);
  this.prefix=`ps2/${id}/`;this.states=this.prefix+'states/'+this.format+'/';
  const files=await this.manager.load(this.prefix+'cards');
  for(const file of files||[]){
   if(!validCard(file.name))continue;
   const path=ROOT+'/'+file.name;this.module.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));
   this.module.FS.writeFile(path,file.content instanceof Blob?new Uint8Array(await file.content.arrayBuffer()):file.content);
  }
  this.retry=!!files;
 }
 files(){const result=[],FS=this.module.FS;
  const walk=(path,prefix)=>{for(const name of FS.readdir(path)){if(name==='.'||name==='..')continue;const child=path+'/'+name,relative=prefix+name,stat=FS.lstat(child);
   if(FS.isDir(stat.mode))walk(child,relative+'/');else if(FS.isFile(stat.mode)&&validCard(relative))result.push({name:relative,content:FS.readFile(child)});
  }};walk(ROOT,'');return result;
 }
 async store(path,files,label){
  this.lastCloudError='';
  this.report(`Saving ${label}…`,true);
  try{const ok=await this.manager.save(path,files)!==false;
   this.report(ok?(await this.manager.isCloudEnabled()?`${label} uploaded to cloud.`:`${label} saved locally.`):`${label} saved locally; ${this.lastCloudError||'cloud upload needs attention.'}`);
   return ok;
  }catch(error){this.report(error.message);throw error;}
 }
 cards(){return this.serialize(async()=>{
  if(this.manager.gameSavesDisabled)return;
  const files=this.files(),changed=await this.manager.checkFilesChanged(files);
  if(!changed&&!this.retry){this.report('Memory cards are unchanged.');return;}
  this.retry=true;this.retry=!await this.store(this.prefix+'cards',files,'Memory cards');
 });}
 check(slot){if(!Number.isInteger(slot)||slot<1||slot>8)throw new Error('Invalid PS2 save slot.');}
 save(slot,bytes,shot){return this.serialize(async()=>{
  this.check(slot);if(this.manager.gameSavesDisabled)throw new Error('Game saves are disabled in settings.');
  return this.store(this.states+slot,[{name:'state',content:new Blob([bytes])},{name:'meta.json',content:new TextEncoder().encode(JSON.stringify({time:Date.now(),shot}))}],'Save state');
 });}
 load(slot){return this.serialize(async()=>{this.check(slot);const files=await this.manager.load(this.states+slot),state=files?.find(file=>file.name==='state');if(!state)throw new Error('This slot has no state for this PS2 core version.');return state.content instanceof Blob?new Uint8Array(await state.content.arrayBuffer()):new Uint8Array(state.content);});}
 slots(){return this.serialize(async()=>{
  const slots=new Array(9);
  for(let slot=1;slot<=8;slot++){
   const files=await (this.manager.inspectSave?this.manager.inspectSave(this.states+slot):this.manager.load(this.states+slot));
   if(!files?.some(file=>file.name==='state'))continue;
   let meta={};const file=files.find(file=>file.name==='meta.json');
   if(file)try{meta=JSON.parse(file.content instanceof Blob?await file.content.text():new TextDecoder().decode(file.content));}catch{}
   slots[slot]={time:meta.time,shot:typeof meta.shot==='string'&&meta.shot.startsWith('data:image/png;base64,')?meta.shot:'./ps2.svg',imageProps:{objectFit:'contain'}};
  }return slots;
 });}
 delete(slot){return this.serialize(async()=>{this.check(slot);return this.store(this.states+slot,[],'Save state cleared');});}
}
