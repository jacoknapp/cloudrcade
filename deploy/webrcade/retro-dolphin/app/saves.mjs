// Reuse the same account-scoped, conflict-aware save bridge as the other cores.
export class GameCubeSaves {
  constructor(title, props, onError = () => {}) { this.title=title;this.props=props;this.onError=onError;this.manager=null;this.gameId=null;this.syncStatus='';this.syncing=false;this.listeners=new Set();this.cardsPending=null;this.queue=Promise.resolve(); }
  subscribe(listener) { this.listeners.add(listener); return ()=>this.listeners.delete(listener); }
  report(text, busy=false) { if(text===this.syncStatus&&busy===this.syncing)return;this.syncStatus=text;this.syncing=busy;for(const listener of this.listeners)listener(); }
  async initialize(adapter, disc) {
    const sdk = await import('./save-sdk.mjs');
    if (!globalThis.WrcadCloud) throw new Error('CloudRcade save bridge did not load.');
    WrcadCloud.install(sdk);
    await sdk.settings.load();
    this.manager = new sdk.SaveManager({getTitle:()=>this.title,getProps:()=>this.props},this.onError);
    this.manager.cloudRequestTimeoutMs=60000;
    this.manager.createZip=sdk.createSaveZip;
    this.manager.getFiles=blob=>sdk.readSaveZip(blob);
    this.manager.getSaveMetadata=blob=>sdk.readSaveZip(blob,true);
    this.gameId=disc.gameId;
    const info=await fetch('./core-info.json').then(r=>r.json());
    this.statePrefix=`gamecube/${disc.gameId}/states/${info.stateFormatId || info.artifacts['dolphin-core-upstream.wasm']}/`;
    this.cardPath=`gamecube/${disc.gameId}/cards`;
    const files=await this.manager.load(this.cardPath);
    const cards=(files || []).filter(f=>/\.gci$/i.test(f.name));
    for(const file of cards)if(file.content instanceof Blob)file.content=new Uint8Array(await file.content.arrayBuffer());
    await adapter.request('importCards',{files:cards});
    await this.manager.checkFilesChanged(cards);
    this.cardsNeedSync=true; // Retry any inherited local recovery record once.
  }
  serialize(action) {
    const next=this.queue.then(action);
    this.queue=next.catch(()=>{});
    return next;
  }
  async store(path, files, label) {
    this.syncing=true;
    try {
      this.report(await this.manager.isCloudEnabled?.()?`Uploading ${label.toLowerCase()}…`:`Saving ${label.toLowerCase()}…`,true);
      const pending=await this.manager.save(path,files) === false;
      this.syncStatus=pending?`${label} saved locally; cloud upload needs attention.`:
        await this.manager.isCloudEnabled?.()?`${label} uploaded to cloud.`:`${label} saved locally; cloud sync is off.`;
      if(pending)this.onError(this.syncStatus);
      return !pending;
    } catch(error) {
      this.syncStatus=`${label} could not be saved: ${error.message}`;
      throw error;
    } finally { this.report(this.syncStatus); }
  }
  cards(adapter, {refresh=false}={}) {
    // Autosave ticks share the current upload. Menu/exit also request one
    // trailing export, so game progress made during an upload is included.
    if(this.cardsPending){if(refresh)this.cardsRefreshRequested=true;return this.cardsPending;}
    if(refresh)this.report('Checking memory cards…',true);
    this.cardsPending=this.serialize(async()=>{
      do {
        this.cardsRefreshRequested=false;
        await this.flushCards(adapter);
      } while(this.cardsRefreshRequested);
    }).finally(()=>{this.cardsPending=null;this.report(this.syncStatus);});
    return this.cardsPending;
  }
  async flushCards(adapter) {
    if (!this.manager) return;
    if(this.manager.gameSavesDisabled){this.syncStatus='Game saves are disabled in settings.';return;}
    const {files}=await adapter.request('exportCards');
    if (this.manager.checkFilesChanged && !await this.manager.checkFilesChanged(files) && !this.cardsNeedSync) {
      if(this.syncing)this.report('Memory cards are unchanged; no upload needed.');
      return;
    }
    // Hashes change before storage is attempted. Keep a thrown write retryable.
    this.cardsNeedSync=true;
    this.cardsNeedSync = !await this.store(this.cardPath,files,'Memory cards');
  }
  saveState(adapter, slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    if(this.manager.gameSavesDisabled)throw new Error('Game saves are disabled in settings.');
    this.report('Creating save state…',true);
    try {
      const result=await adapter.saveStateFile();
      if (!result.saved || !result.bytes) throw new Error(result.error || 'Dolphin could not save the state.');
      const content=new Blob([result.bytes]);result.bytes=null;
      await this.store(this.statePrefix+slot,[{name:'state',content},
        {name:'meta.json',content:new TextEncoder().encode(JSON.stringify({time:Date.now()}))}],'State');
    } catch(error) { this.report(error.message);throw error; }
    finally { this.report(this.syncStatus); }
  }); }
  loadState(adapter, slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    this.report('Loading save state…',true);
    try {
      const files=await this.manager.load(this.statePrefix+slot);
      const state=files?.find(f=>f.name === 'state');
      if (!state) throw new Error('This slot has no state for this GameCube core version.');
      const bytes=state.content instanceof Blob?new Uint8Array(await state.content.arrayBuffer()):new Uint8Array(state.content);
      const result=await adapter.request('loadStateFile',{bytes},[bytes.buffer]);
      if (!result.loaded) throw new Error(result.error || 'Dolphin could not load the state.');
      this.report('State loaded.');
    } catch(error) { this.report(error.message);throw error; }
    finally { this.report(this.syncStatus); }
  }); }
  stateSlots() { return this.serialize(async()=>{
    const slots=new Array(9);
    for(let slot=1;slot<=8;slot++){
      const files=await (this.manager.inspectSave?this.manager.inspectSave(this.statePrefix+slot):this.manager.load(this.statePrefix+slot));
      if(!files?.some(file=>file.name==='state'))continue;
      let time;
      const meta=files.find(file=>file.name==='meta.json');
      if(meta)try{time=JSON.parse(meta.content instanceof Blob?await meta.content.text():new TextDecoder().decode(meta.content)).time;}catch{ /* Earlier states remain loadable. */ }
      slots[slot]={time,shot:'./gamecube.svg',imageProps:{objectFit:'contain'}};
    }
    return slots;
  }); }
  deleteState(slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    // Empty, account-scoped records also clear the local recovery copy.
    if(await this.manager.save(this.statePrefix+slot,[]) === false)throw new Error('State cleared locally; cloud sync needs attention.');
  }); }
  checkSlot(slot) { if (!this.manager || !Number.isInteger(slot) || slot<1 || slot>8) throw new Error('Invalid save slot.'); }
}
