// Sync only title save data. Executable content, tickets and console keys never enter saves.
const roots=['/dolphin-user/Wii/title','/dolphin-user/WiiSession/title'];
const safe=name=>/^[0-9a-f]{8}\/[0-9a-f]{8}\/data\/(?:[^/]+\/)*[^/]+$/i.test(name)&&
 name.split('/').every(part=>part!=='.'&&part!=='..'&&!part.includes('\\')&&!part.includes('\0'));
export function exportNand(fs){
 const files=new Map();let total=0;
 function visit(root,path=''){
  let entries;try{entries=fs.readdir(root+'/'+path);}catch{return;}
  for(const entry of entries){if(entry==='.'||entry==='..')continue;const name=path?path+'/'+entry:entry,absolute=root+'/'+name;
   const stat=fs.lstat(absolute);if(fs.isDir(stat.mode)){visit(root,name);continue;}
   if(!fs.isFile(stat.mode)||!safe(name))continue;
   const bytes=fs.readFile(absolute);total+=bytes.length-(files.get(name)?.content.length||0);if(total>64*1024*1024)throw new Error('Wii save data exceeds 64 MiB.');
   files.set(name,{name,content:new Uint8Array(bytes)});
  }
 }
 for(const root of roots)visit(root);return [...files.values()];
}
export function importNand(fs,files){
 if(!Array.isArray(files))throw new Error('Invalid Wii save files.');
 let total=0;const checked=files.map(file=>{if(!safe(file.name))throw new Error('Invalid Wii save path.');
  const bytes=new Uint8Array(file.content);total+=bytes.length;if(total>64*1024*1024)throw new Error('Wii save data exceeds 64 MiB.');return {name:file.name,bytes};});
 for(const {name,bytes}of checked)for(const root of roots){const path=root+'/'+name;fs.mkdirTree(path.slice(0,path.lastIndexOf('/')));fs.writeFile(path,bytes);}
 return checked.length;
}
