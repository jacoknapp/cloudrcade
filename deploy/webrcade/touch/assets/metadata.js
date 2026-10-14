/* Fetch metadata only for the selected game; provider credentials stay server-side. */
(() => {
  'use strict';
  const patched=new WeakSet(),seen=new WeakSet();
  const normalize=value=>Array.isArray(value)?value.map(normalize):typeof value==='string'&&/^https?:\/\//.test(value)?new URL(value).pathname+new URL(value).search:value;
  async function hydrate(browse,item){
    if(!item?.type||seen.has(item)||!crypto.subtle)return;
    const props=item.getProps?item.getProps():item.props;
    if(!props||!(props.uid||props.rom||props.discs))return;
    seen.add(item);
    try{
      const raw=JSON.stringify([item.type,normalize(props.uid||props.rom||props.discs)]);
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
      const key=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
      const response=await fetch('/cloud-saves/metadata.php?key='+key,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!response.ok)return;
      const value=await response.json();
      if(value.pending){seen.delete(item);if(browse.state.currentItem===item)setTimeout(()=>hydrate(browse,item),1200);return;}
      if(!value.available)return;
      for(const field of ['longTitle','description','thumbnail'])if(typeof value.metadata?.[field]==='string')item[field]=value.metadata[field];
      if(browse.state.currentItem===item)browse.forceUpdate();
    }catch(_){} // Metadata availability never blocks selection or launching a game.
  }
  window.WrcadMetadata={install({Browse}){
    if(!Browse?.prototype||patched.has(Browse))return;patched.add(Browse);
    const update=Browse.prototype.componentDidUpdate;
    Browse.prototype.componentDidUpdate=function(...args){const result=update?.apply(this,args);
      clearTimeout(this.wrcadMetadataTimer);if(this.props.hide||this.props.disable)return result;const item=this.state.currentItem;
      if(this.state.menuMode==='apps'||this.state.searchTerm)this.wrcadMetadataTimer=setTimeout(()=>hydrate(this,item),350);
      return result;};
    const unmount=Browse.prototype.componentWillUnmount;
    Browse.prototype.componentWillUnmount=function(...args){clearTimeout(this.wrcadMetadataTimer);return unmount?.apply(this,args);};
  }};
})();
