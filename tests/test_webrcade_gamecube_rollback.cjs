// Compile the shipped native rollback helper directly from its source patch.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const patch=fs.readFileSync(path.join(__dirname,'../deploy/webrcade/retro-dolphin/native-patches/0009-compress-restore-rollback.patch'),'utf8');
const marker='+++ b/Source/Core/Core/ChunkedRollbackBuffer.h\n';
const section=patch.split(marker)[1]?.split('\n--- ')[0];
if(!section)throw Error('Native rollback header missing from source patch');
const header=section.split('\n').filter(line=>line.startsWith('+')&&!line.startsWith('+++')).map(line=>line.slice(1)).join('\n')+'\n';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gamecube-rollback-'));
try{
 fs.writeFileSync(path.join(dir,'ChunkedRollbackBuffer.h'),header);
 const binary=path.join(dir,'test');
 execFileSync(process.env.CXX||'c++',['-std=c++20','-Wall','-Wextra','-Werror','-I'+dir,path.join(__dirname,'test_webrcade_gamecube_rollback.cpp'),'-o',binary],{stdio:'inherit'});
 execFileSync(binary,[],{stdio:'inherit'});
 console.log('PASS native GameCube rollback chunks, ownership, budget fallback and decode failures');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
