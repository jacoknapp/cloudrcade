import {zip} from '@gamecube/common-zip';

// Dolphin snapshots are already LZ4-compressed. Keep their ZIP entries stored
// and Blob-backed instead of deflating them again and making full JS copies.
export function createSaveZip(files) {
  zip.useWebWorkers=false;
  return new Promise((resolve,reject)=>{
    const fail=error=>reject(error instanceof Error?error:new Error(String(error)));
    zip.createWriter(new zip.BlobWriter('application/zip'),writer=>{
    let index=0;
    const next=()=>{
      if(index===files.length)return writer.close(resolve);
      const file=files[index++],blob=file.content instanceof Blob?file.content:new Blob([file.content]);
      writer.add(file.name,new zip.BlobReader(blob),next,undefined,{level:file.name==='state'?0:undefined});
    };
    next();
  },fail);
  });
}

export function readSaveZip(blob, metadataOnly=false) {
  zip.useWebWorkers=false;
  return new Promise((resolve,reject)=>{
    const fail=error=>reject(error instanceof Error?error:new Error(String(error)));
    zip.createReader(new zip.BlobReader(blob),reader=>{
    reader.getEntries(entries=>{
      const files=[];let index=0;
      const next=()=>{
        if(index===entries.length)return reader.close(()=>resolve(files));
        const entry=entries[index++];
        // Slot browsing needs the name, never the snapshot's decompressed data.
        if(metadataOnly&&entry.filename==='state'){files.push({name:'state'});return next();}
        entry.getData(new zip.BlobWriter(),content=>{files.push({name:entry.filename,content});next();},undefined,true);
      };
      next();
    },fail);
  },fail);
  });
}
