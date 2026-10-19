#!/usr/bin/env python3
"""Build/verify Wii's additional native input patch over qualified GameCube source.

Prepare GameCube first. WII_WORK (new directory) and WII_TOOLCHAIN own scratch;
WII_NATIVE_CACHE can reuse hash-verified Wii bytes. --qualify explicitly records a
new source/artifact lock after a source build; normal builds require that lock.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

HERE=Path(__file__).resolve().parent
GC=HERE.parent/'retro-dolphin'
REPO=HERE.parents[2]
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def build():
    qualify=sys.argv[1:]==['--qualify']
    if sys.argv[1:] and not qualify:raise SystemExit('Usage: build-native.py [--qualify]')
    base=Path(os.environ.get('GAMECUBE_APP',REPO/'release/gamecube/app')).resolve()
    work=Path(os.environ.get('WII_WORK','/tmp/cloudrcade-wii-build')).resolve()
    out=Path(os.environ.get('OUT',REPO/'release/wii-native')).resolve()
    if work.exists() or out.exists():raise SystemExit('WII_WORK and OUT must be new directories')
    baseline=json.loads((GC/'native-build.json').read_text())
    info=json.loads((base/'core-info.json').read_text())
    if info['artifacts']!=baseline['artifacts'] or sha(base/'gamecube-source.tar.gz')!=info['sourceSha256']:
        raise SystemExit('GameCube source package integrity mismatch')
    work.mkdir(parents=True)
    with tarfile.open(base/'gamecube-source.tar.gz') as archive:archive.extractall(work,filter='data')
    spec=importlib.util.spec_from_file_location('gc_build',GC/'native-build.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    if module.source_digest(work)!=baseline['sourceTreeSha256']:raise SystemExit('GameCube source tree mismatch')
    subprocess.run(['git','apply','--check',str(HERE/'wii-input.patch')],cwd=work,check=True)
    subprocess.run(['git','apply',str(HERE/'wii-input.patch')],cwd=work,check=True)
    source_digest=module.source_digest(work)
    previous=json.loads((HERE/'native-build.json').read_text()) if (HERE/'native-build.json').exists() else {}
    lock={**baseline,'baseNativeSourceSha256':baseline['sourceTreeSha256'],'sourceTreeSha256':source_digest,
          'patchSha256':sha(HERE/'wii-input.patch'),'recipeSha256':sha(GC/'build-linux.sh')}
    if not qualify and any(previous.get(key)!=value for key,value in lock.items() if key not in ('artifacts','stateFormatId')):
        raise SystemExit('Wii inputs changed; explicitly source-build and qualify them')
    cache=os.environ.get('WII_NATIVE_CACHE')
    if qualify and cache:raise SystemExit('Qualification requires a fresh source build')
    if cache:artifacts=Path(cache)
    else:
        toolchain=Path(os.environ.get('WII_TOOLCHAIN','/tmp/cloudrcade-wii-toolchain')).resolve();toolchain.mkdir(parents=True,exist_ok=True)
        subprocess.run(['docker','run','--rm','--platform',baseline['platform'],
                        '-e','GAMECUBE_BUILD_JOBS='+os.environ.get('GAMECUBE_BUILD_JOBS','8'),
                        '-e','GAMECUBE_BUILD_UID='+str(os.getuid()),
                        '-e','GAMECUBE_BUILD_GID='+str(os.getgid()),
                        '-v',f'{work}:/work','-v',f'{toolchain}:/toolchain',
                        '-v',f'{GC}:/recipe:ro',baseline['image'],'bash','/recipe/build-linux.sh'],check=True)
        artifacts=work/'build/linux-artifacts'
    if module.source_digest(work)!=source_digest:raise SystemExit('Build changed its source inputs')
    out.mkdir(parents=True)
    for name in baseline['artifacts']:shutil.copy2(artifacts/name,out/name)
    lock['artifacts']={name:sha(out/name) for name in baseline['artifacts']}
    lock['stateFormatId']=lock['artifacts']['dolphin-core-upstream.wasm']
    (out/'actual-native-build.json').write_text(json.dumps(lock,indent=2)+'\n')
    if not qualify and previous['artifacts']!=lock['artifacts']:
        raise SystemExit('Wii native artifact mismatch: '+json.dumps({
            'expected':previous['artifacts'],'actual':lock['artifacts']},sort_keys=True))
    if qualify:(HERE/'native-build.json').write_text(json.dumps(lock,indent=2)+'\n')
    # Distribute the fully patched source and the precise additional recipe/lock.
    readme=work/'README.md'
    readme.write_text('# CloudRcade experimental Wii corresponding source\n\nThis tree includes every qualified GameCube native patch plus the Wii Remote/Nunchuk input patch. The additional Wii source/artifact identity is in cloudrcade-wii/native-build.json. Rebuild the extracted tree with the pinned SDK image and cloudrcade-native/build-linux.sh; the source already contains both patch series.\n\n'+readme.read_text())
    recipe=work/'cloudrcade-wii';recipe.mkdir()
    for name in ('wii-input.patch','build-native.py','native-build.json'):shutil.copy2(HERE/name,recipe/name)
    names=['LICENSE','README.md','package.json','vendor/dolphin','core/upstream','patches/dolphin-wasm','provenance','tools','cloudrcade-native','cloudrcade-wii']
    subprocess.run(['tar','--sort=name','--mtime=@'+str(baseline['sourceDateEpoch']),'--owner=0','--group=0','--numeric-owner','--exclude=.git','--exclude=target','--exclude=__pycache__','-czf',str(out/'wii-source.tar.gz'),'-C',str(work),*names],check=True)
    print('Qualified Wii native package: '+str(out))
if __name__=='__main__':build()
