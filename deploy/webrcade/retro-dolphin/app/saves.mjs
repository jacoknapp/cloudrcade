// Reuse the same account-scoped, conflict-aware save bridge as the other cores.
export class GameCubeSaves {
  constructor(title, props, onError = () => {}) { this.title=title;this.props=props;this.onError=onError;this.manager=null;this.gameId=null;this.queue=Promise.resolve(); }
  async initialize(adapter, disc) {
    const sdk = await import('./save-sdk.mjs');
    if (!globalThis.WrcadCloud) throw new Error('CloudRcade save bridge did not load.');
    WrcadCloud.install(sdk);
    await sdk.settings.load();
    this.manager = new sdk.SaveManager({getTitle:()=>this.title,getProps:()=>this.props},this.onError);
    this.gameId=disc.gameId;
    const info=await fetch('./core-info.json').then(r=>r.json());
    this.statePrefix=`gamecube/${disc.gameId}/states/${info.artifacts['dolphin-core-upstream.wasm']}/`;
    this.cardPath=`gamecube/${disc.gameId}/cards`;
    const files=await this.manager.load(this.cardPath);
    const cards=(files || []).filter(f=>/\.gci$/i.test(f.name));
    await adapter.request('importCards',{files:cards});
    await this.manager.checkFilesChanged(cards);
    this.cardsNeedSync=true; // Retry any inherited local recovery record once.
  }
  serialize(action) {
    const next=this.queue.then(action);
    this.queue=next.catch(()=>{});
    return next;
  }
  cards(adapter) { return this.serialize(async()=>{
    if (!this.manager) return;
    const {files}=await adapter.request('exportCards');
    if (this.manager.checkFilesChanged && !await this.manager.checkFilesChanged(files) && !this.cardsNeedSync) return;
    // Hashes change before storage is attempted. Keep a thrown write retryable.
    this.cardsNeedSync=true;
    this.cardsNeedSync = await this.manager.save(this.cardPath,files) === false;
    if (this.cardsNeedSync) this.onError('Memory cards saved locally; cloud sync needs attention.');
  }); }
  saveState(adapter, slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    const result=await adapter.saveStateFile();
    if (!result.saved || !result.bytes) throw new Error(result.error || 'Dolphin could not save the state.');
    if (await this.manager.save(this.statePrefix+slot,[{name:'state',content:new Uint8Array(result.bytes)},
      {name:'meta.json',content:new TextEncoder().encode(JSON.stringify({time:Date.now()}))}]) === false) this.onError('State saved locally; cloud sync needs attention.');
  }); }
  loadState(adapter, slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    const files=await this.manager.load(this.statePrefix+slot);
    const state=files?.find(f=>f.name === 'state');
    if (!state) throw new Error('This slot has no state for this GameCube core version.');
    const result=await adapter.request('loadStateFile',{bytes:state.content});
    if (!result.loaded) throw new Error(result.error || 'Dolphin could not load the state.');
  }); }
  stateSlots() { return this.serialize(async()=>{
    const slots=new Array(9);
    for(let slot=1;slot<=8;slot++){
      const files=await this.manager.load(this.statePrefix+slot);
      if(!files?.some(file=>file.name==='state'))continue;
      let time;
      const meta=files.find(file=>file.name==='meta.json');
      if(meta)try{time=JSON.parse(new TextDecoder().decode(meta.content)).time;}catch{ /* Earlier states remain loadable. */ }
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
