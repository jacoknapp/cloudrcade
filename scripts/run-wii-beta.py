#!/usr/bin/env python3
"""Run an isolated local Wii beta over a pinned stable runtime.

Requires Docker and prepared release/wii/app. Binds HTTPS to loopback only,
uses task-owned config and an empty ROM directory, and disables cloud/scanning.
WII_BETA_STATE, WII_BETA_PORT, WII_BETA_NAME override development defaults.
Stop with: docker stop cloudrcade-wii-beta. No production configuration is read.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

REPO=Path(__file__).resolve().parents[1]
BASE='ghcr.io/jacoknapp/cloudrcade@sha256:2b63b674d1f322c5f88f848fa725473348b457ba50083294decc5524c7cb4aeb'
UPSTREAM='webrcade/webrcade@sha256:77789de80c2963d58631b57306335638eec8f6425c66b7d6868576f0ea5f7a49'
def run(*args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def main():
    app=REPO/'release/wii/app'
    if not (app/'core-info.json').is_file():raise SystemExit('Prepare release/wii first; see deploy/webrcade/retro-wii/README.md')
    root=Path(os.environ.get('WII_BETA_STATE',REPO/'release/wii-local')).resolve();root.mkdir(parents=True,exist_ok=True)
    name=os.environ.get('WII_BETA_NAME','cloudrcade-wii-beta')
    port=int(os.environ.get('WII_BETA_PORT','18573'))
    if not 1024<=port<=65535:raise SystemExit('Choose an unprivileged port')
    existing=subprocess.run(['docker','inspect',name],capture_output=True)
    if not existing.returncode:raise SystemExit('Container already exists: '+name+'; stop/remove it explicitly before restarting')
    run('docker','pull',BASE)
    raw=subprocess.check_output(['docker','run','--rm','--entrypoint','/bin/cat',UPSTREAM,'/var/www/html/play/static/js/main.7ac86965.chunk.js'])
    (root/'original-player.js').write_bytes(raw)
    spec=importlib.util.spec_from_file_location('patch_player',REPO/'deploy/webrcade/patch-player.py');patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)
    (root/'player.js').write_bytes(patch.patch_bundle(raw))
    run('docker','run','--rm','--entrypoint','python3','-v',str(REPO)+':/source:ro','-v',str(root)+':/stage','-v',str(root/'original-player.js')+':/var/www/html/play/static/js/main.7ac86965.chunk.js:ro','-e','WEBRCADE_SOURCE_ROOT=/var/www/html','-e','WEBRCADE_TOUCH_ROOT=/stage/pages',BASE,'/source/deploy/webrcade/prepare-touch.py')
    feed=root/'config/data/feeds';feed.mkdir(parents=True,exist_ok=True)
    if not (feed/'combined.json').exists():
        (feed/'combined.json').write_text(json.dumps({'title':'Wii beta','categories':[{'title':'No games','items':[]}]}))
    (root/'roms').mkdir(exist_ok=True)
    args=['docker','run','-d','--pull','never','--name',name,'--label','io.cloudrcade.task=wii-beta','-p',f'127.0.0.1:{port}:443']
    for key,value in {'WEBRCADE_SCAN_ENABLED':'false','NEXTCLOUD_ENABLED':'false','DROPBOX_ENABLED':'false','WEBRCADE_METADATA_ENABLED':'false','WEBRCADE_STORAGE_PREFIX':'cloudrcade-wii-beta','WEBRCADE_APP_NAME':'CloudRcade Wii beta'}.items():args+=['-e',key+'='+value]
    mounts=[(root/'config','/config',''),(root/'roms','/roms',':ro'),(root/'pages','/var/www/touch/pages',':ro'),(root/'player.js','/var/www/html/play/static/js/main.7ac86965.chunk.js',':ro'),(REPO/'deploy/webrcade/touch/assets','/var/www/touch/assets',':ro'),(REPO/'deploy/webrcade/touch/cloud','/var/www/touch/cloud',':ro'),(REPO/'deploy/webrcade/retro-wii/apache.conf','/etc/apache2/conf-enabled/wii.conf',':ro'),(app,'/var/www/html/experimental/wii',':ro'),(REPO/'deploy/webrcade/refresh-feed.py','/usr/local/share/cloudrcade/refresh-feed.py',':ro'),(REPO/'deploy/webrcade/metadata_lookup.py','/usr/local/share/cloudrcade/metadata_lookup.py',':ro')]
    for source,destination,mode in mounts:args+=['-v',str(source)+':'+destination+mode]
    run(*args,BASE)
    print(f'Local beta: https://localhost:{port}/play/\nWii launcher: https://localhost:{port}/experimental/wii/\nEnable Wii (experimental) in Settings → Core Settings. Select a local Wii ISO in the launcher.')
if __name__=='__main__':main()
