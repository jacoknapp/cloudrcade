const prefix=()=>globalThis.WrcadCloudConfig?.storagePrefix||'webrcade';
export function enabled(){try{return localStorage.getItem(prefix()+'.ps2.enabled.v1')==='1';}catch{return false;}}
export function perfEnabled(){try{return localStorage.getItem(prefix()+'.ps2.perf.v1')==='1';}catch{return false;}}
