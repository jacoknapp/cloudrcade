#!/usr/bin/env python3
"""Build the experimental Wii adapter from the current qualified GameCube package.

Prepare GameCube first. WII_NATIVE points at a separately qualified Wii native
build; no games or accounts are inputs. Generated output defaults to release/wii.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def replace(text, old, new):
    if text.count(old)!=1: raise RuntimeError('Unexpected shared Dolphin anchor: '+old[:90])
    return text.replace(old,new)
def prepare(base, native, out):
    info=json.loads((base/'core-info.json').read_text())
    baseline=json.loads((HERE.parent/'retro-dolphin/native-build.json').read_text())
    lock=json.loads((HERE/'native-build.json').read_text())
    if info['hostPatchSha256']!=sha(HERE.parent/'retro-dolphin/patch-runtime.py'):raise RuntimeError('Refresh the current GameCube browser host first')
    if info['artifacts']!=baseline['artifacts']:raise RuntimeError('Prepare the current GameCube native baseline first')
    for name,digest in baseline['artifacts'].items():
        if sha(base/'cores/dolphin'/name)!=digest:raise RuntimeError('GameCube native integrity mismatch')
    if lock['baseNativeSourceSha256']!=baseline['sourceTreeSha256'] or lock['patchSha256']!=sha(HERE/'wii-input.patch'):
        raise RuntimeError('Wii native inputs need qualification')
    for key in ('image','platform','rustToolchain','sourceDateEpoch','memoryPages','patches','recipeSha256'):
        if lock[key]!=baseline[key]:raise RuntimeError('Wii toolchain/recipe must follow the current GameCube baseline: '+key)
    for name,digest in lock['artifacts'].items():
        if sha(native/name)!=digest:raise RuntimeError('Wii native integrity mismatch')
    # All shared adapter source files must match today's source, not stale release output.
    for path in (HERE.parent/'retro-dolphin/app').glob('*.mjs'):
        if sha(path)!=sha(base/path.name):raise RuntimeError('Refresh GameCube adapter: '+path.name)
    if out.exists():raise RuntimeError('OUT must be a new directory')
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='wii-',dir=out.parent) as tmp:
        stage=Path(tmp);app=stage/'app'
        shutil.copytree(base,app,copy_function=shutil.copy2)
        # The native archive and recipe belong to this Wii build.
        shutil.copy2(native/'wii-source.tar.gz',app/'wii-source.tar.gz')
        (app/'gamecube-source.tar.gz').unlink()
        for name in lock['artifacts']:shutil.copy2(native/name,app/'cores/dolphin'/name)
        protocol=app/'vendor/src/upstream-worker-protocol.js'
        protocol.write_text(replace(protocol.read_text(),baseline['artifacts']['dolphin-core-upstream.wasm'],lock['artifacts']['dolphin-core-upstream.wasm']))
        for path in app.glob('*.mjs'):
            text=path.read_text().replace('GameCube ', 'Wii ').replace("'GameCube'", "'Wii'").replace('`GameCube ', '`Wii ')
            text=text.replace('.gamecube.perf.v1','.wii.perf.v1').replace('./gamecube.svg','./wii.svg')
            path.write_text(text)
        session=app/'session.mjs';text=session.read_text();start=text.index('export async function inspectDisc(');end=text.index('\nexport class GameCubeSession',start)
        text=text[:start]+"import {inspectDisc} from './disc.mjs';\nexport {inspectDisc};\n"+text[end:]
        text=replace(text,"await inspectDisc(file.remote ? {...file,slice:()=>new Blob([file.header])} : file)","file.remote ? {...file.disc} : await inspectDisc(file)")
        session.write_text(text)
        for name in ('disc.mjs','transport.mjs','input.mjs','nand.mjs','wii.svg','controls.mjs','controls.css'):shutil.copy2(HERE/name,app/name)
        lab=app/'lab.mjs';text=lab.read_text().replace("import {KEYS, padState, BUTTONS}","import {KEYS, padState, BUTTONS, attachMotion, applyMotion, applyControllerLayout, applyPhoneMotion}")
        text=text.replace("const pressed=new Set(), input={};",'''const pressed=new Set(), input={};
const motion=attachMotion(window,{getCanvas:()=>canvas,isActive:()=>!!session?.booted&&!session.paused&&!menuVisible&&!controllerMenuVisible&&!busy&&!exiting});
const wiiEnabled=()=>{try{return localStorage.getItem((window.WrcadCloudConfig?.storagePrefix||'webrcade')+'.wii.enabled.v1')==='1';}catch{return false;}};
const wiiControls=createWiiControls(window,{isActive:()=>!!session?.booted&&!session.paused&&!menuVisible&&!controllerMenuVisible&&!busy&&!exiting,onChange:()=>{motion.clear();pressed.clear();}});
const disabledMessage='Enable Wii (experimental) in Settings → Core Settings.';''')
        text="import {createWiiControls} from './controls.mjs';\n"+text
        text=replace(text,' session.setInput(input);session.poll();',' applyMotion(input,motion.sample());applyPhoneMotion(input,wiiControls.phone.sample());applyControllerLayout(input,wiiControls.layout);session.setInput(input);session.poll();')
        text=replace(text,' backgroundPause.reset();',' motion.clear();wiiControls.stop();backgroundPause.reset();')
        text=replace(text,' if(busy||exiting)return;busy=true;', ' if(!wiiEnabled()){status(disabledMessage);return;}\n if(busy||exiting)return;busy=true;')
        text=replace(text,' if(busy||session?.booted)return;busy=true;', ' if(!wiiEnabled()){status(disabledMessage);return;}\n if(busy||session?.booted)return;busy=true;')
        text=text.replace(' pressed.clear();if(pausing)', ' motion.clear();pressed.clear();if(pausing)')
        text=text.replace('menuOpen(open){controllerMenuVisible=', 'menuOpen(open){motion.clear();controllerMenuVisible=')
        # Touch labels retain the GameCube placement; Wii owns the transport semantics.
        text=text.replace("[10,'Z']", "[10,'HOME']")
        text=replace(text," if(state.mask&BUTTONS.L)state.triggerLeft=255;if(state.mask&BUTTONS.R)state.triggerRight=255;\n if(state.mask&BUTTONS.A)state.analogA=255;if(state.mask&BUTTONS.B)state.analogB=255;",'')
        text=text.replace("controls();\nif(document.hidden)", "controls();\nif(!wiiEnabled())status(disabledMessage);\nif(document.hidden)")
        # Native menu release must contain neutral accelerometer bytes.
        text=text.replace('triggerLeft:0,triggerRight:0,analogA:0,analogB:0','triggerLeft:128,triggerRight:128,analogA:154,analogB:128')
        text=text.replace('if(open)session?.setInput({mask:0,', "if(open)session?.setInput({mask:wiiControls.layout==='nunchuk'?0:(1<<14),")
        text=text.replace('window.WrcadGameCube={', 'window.WrcadGameCube={get controllerLayout(){return wiiControls.layout;},')
        text=text.replace('window.WrcadGameCube=', 'window.WrcadWii=').replace('Memory cards','Wii saves').replace('memory cards','Wii saves')
        lab.write_text(text)
        text=session.read_text().replace('triggerLeft: 0, triggerRight: 0, analogA: 0, analogB: 0','triggerLeft: 128, triggerRight: 128, analogA: 154, analogB: 128')
        text="import {padState,applyControllerLayout} from './input.mjs';\n"+text
        text=text.replace('await this.bounded(adapter.load());', "await this.bounded(adapter.load());\n      adapter.setInputState(applyControllerLayout(padState(),this.scope.WrcadWii?.controllerLayout || 'nunchuk'));")
        text=text.replace('this.adapter.setInputState({mask: 0,', "this.adapter.setInputState({mask: this.scope.WrcadWii?.controllerLayout && this.scope.WrcadWii.controllerLayout !== 'nunchuk' ? (1<<14) : 0,")
        session.write_text(text)
        saves=app/'saves.mjs';text=saves.read_text().replace('gamecube/${disc.gameId}', 'wii/${disc.gameId}').replace('/cards`','/nand`')
        text=text.replace("const cards=(files || []).filter(f=>/\\.gci$/i.test(f.name));",'const cards=files || [];')
        text=text.replace('gamecube.svg','wii.svg')
        text=text.replace("'importCards'","'importNand'").replace("'exportCards'","'exportNand'").replace('Memory cards','Wii saves').replace('memory cards','Wii saves')
        saves.write_text(text)
        worker=app/'vendor/src/upstream-discio-worker.js';text=worker.read_text()
        text='import {importNand,exportNand} from "../../nand.mjs";\n'+text
        text=replace(text,'    case "setInputMask":','''    case "wiiInputProbe": {
      if (coreBoot.accepted && api.getCoreStateName() !== "Paused") throw new Error("Pause Wii before inspecting controller output");
      const pointer=moduleInstance._DolphinWeb_GetWiiReport();
      return {report:Array.from(new Uint32Array(moduleInstance.HEAPU8.buffer,pointer,13))};
    }
    case "importNand": return {imported:importNand(moduleInstance.FS,payload.files || [])};
    case "exportNand": return {files:exportNand(moduleInstance.FS)};
    case "setInputMask":''')
        text=replace(text,'  api.coreInit?.();','''  moduleInstance.FS.mkdirTree('/dolphin-user/Config');
  moduleInstance.FS.writeFile('/dolphin-user/Config/WiimoteNew.ini',
    '[Wiimote1]\\nSource = 1\\nExtension = Nunchuk\\nMotionPlus = True\\n');
  api.coreInit?.();
  api.setInputState?.({mask:0,stickX:128,stickY:128,cStickX:128,cStickY:128,triggerLeft:128,triggerRight:128,analogA:154,analogB:128,inputGeneration:1});''')
        worker.write_text(text)
        html=app/'index.html';text=html.read_text().replace('data-cloudrcade-core="gamecube"','data-cloudrcade-core="wii"').replace('GameCube','Wii').replace('gamecube-source.tar.gz','wii-source.tar.gz').replace('adapter-source/README.md','adapter-source/wii/README.md').replace('ISO or GCM','ISO, WBFS or CISO').replace('accept=".iso,.gcm"','accept=".iso,.wbfs,.ciso"')
        text=text.replace('<h1 id="title">Wii</h1>','<h1 id="title">Wii · Experimental</h1>')
        first=text.index('<p>Keyboard:');last=text.index('</p>',first)
        text=text[:first]+'''<p>Touch or move the mouse over the game to point. Tap/click = A, right click = B; drag for tilt and swing/shake. Wii Remote + Nunchuk: X/Z = A/B, 1/2, Q/E = C/Z, Enter = Plus, minus = Minus, Home = Home; arrows = D-pad; WASD = Nunchuk. Escape = standard pause menu. Choose Remote + Nunchuk, upright or sideways Remote in the controller panel. Enable phone motion there to grant sensor access, then recenter in your comfortable holding position. Portrait and landscape rotations are handled automatically. Touch/mouse motion remains available.</p>'''+text[last+4:]
        text=text.replace('<style>','<link rel="stylesheet" href="controls.css"><style>\n #screen {touch-action:none;}\n #wii-experimental {position:fixed;right:8px;top:8px;z-index:5;font:11px system-ui;background:#111b;padding:4px 8px;pointer-events:none;}')
        text=text.replace('<p id="status"', '<span id="wii-experimental">Wii · Experimental</span>\n<p id="status"')
        for name in ['brand.js','controller.js','viewport.css','controller.css','menus.css']:
            import re
            text=re.sub(r'(/touch-controls/'+re.escape(name)+r')(?:\?v=[a-f0-9]+)?"',r'\1?v='+sha(HERE.parent/'touch/assets'/name)[:16]+'"',text)
        html.write_text(text)
        shutil.copytree(HERE,app/'adapter-source/wii',ignore=shutil.ignore_patterns('__pycache__'))
        info.update(experimental=True,system='wii',nativeBuild=lock,artifacts=lock['artifacts'],stateFormatId=lock['artifacts']['dolphin-core-upstream.wasm'],sharedGameCubeNative=baseline['artifacts'],sourceSha256=sha(app/'wii-source.tar.gz'),hostPatchSha256=sha(HERE/'prepare.py'))
        info['adapterFilesSha256']={p.name:sha(p) for p in sorted(app.glob('*.mjs'))}
        (app/'core-info.json').write_text(json.dumps(info,indent=2)+'\n')
        stage.rename(out)
    print('Prepared experimental Wii core: '+str(out/'app'))
if __name__=='__main__':
    prepare(Path(os.environ.get('GAMECUBE_APP',REPO/'release/gamecube/app')),Path(os.environ.get('WII_NATIVE',REPO/'release/wii-native')),Path(os.environ.get('OUT',REPO/'release/wii')))
