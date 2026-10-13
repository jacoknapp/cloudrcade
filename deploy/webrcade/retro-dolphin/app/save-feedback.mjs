// Keep background memory-card uploads visible after the pause screen closes.
export function saveFeedback(root, saves) {
  let timer;
  const update=()=>{
    clearTimeout(timer);
    root.hidden=!saves.syncStatus;
    root.setAttribute('aria-busy',String(saves.syncing));
    root.querySelector('.gc-save-spinner').hidden=!saves.syncing;
    root.querySelector('[data-save-message]').textContent=saves.syncStatus;
    if(!saves.syncing)timer=setTimeout(()=>{root.hidden=true;},4000);
  };
  const unsubscribe=saves.subscribe(update);
  return ()=>{unsubscribe();clearTimeout(timer);root.hidden=true;};
}
