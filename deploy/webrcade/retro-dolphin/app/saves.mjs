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
    await adapter.request('importCards',{files:(files || []).filter(f=>/\.gci$/i.test(f.name))});
  }
  serialize(action) {
    const next=this.queue.then(action);
    this.queue=next.catch(()=>{});
    return next;
  }
  cards(adapter) { return this.serialize(async()=>{
    if (!this.manager) return;
    const {files}=await adapter.request('exportCards');
    if (await this.manager.save(this.cardPath,files) === false) this.onError('Memory cards saved locally; cloud sync needs attention.');
  }); }
  saveState(adapter, slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    const result=await adapter.saveStateFile();
    if (!result.saved || !result.bytes) throw new Error(result.error || 'Dolphin could not save the state.');
    if (await this.manager.save(this.statePrefix+slot,[{name:'state',content:new Uint8Array(result.bytes)}]) === false) this.onError('State saved locally; cloud sync needs attention.');
  }); }
  loadState(adapter, slot) { return this.serialize(async()=>{
    this.checkSlot(slot);
    const files=await this.manager.load(this.statePrefix+slot);
    const state=files?.find(f=>f.name === 'state');
    if (!state) throw new Error('This slot has no state for this GameCube core version.');
    const result=await adapter.request('loadStateFile',{bytes:state.content});
    if (!result.loaded) throw new Error(result.error || 'Dolphin could not load the state.');
  }); }
  checkSlot(slot) { if (!this.manager || !Number.isInteger(slot) || slot<1 || slot>8) throw new Error('Invalid save slot.'); }
}
