#!/usr/bin/env python3
"""Offline actual-source synchronization, disabled-path and bounded raw trace tests."""
import argparse,hashlib,json,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];NATIVE=ROOT/'deploy/webrcade/retro-play';FIXTURE=ROOT/'tests/fixtures/ps2-handoff'
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--play',type=Path,required=True);p.add_argument('--output',type=Path);args=p.parse_args()
# Use the established Play pin from core.json rather than a mutable working tree.
PIN=json.loads((NATIVE/'core.json').read_text())['commit']
assert subprocess.check_output(['git','-C',str(args.play),'rev-parse','HEAD'],text=True).strip()==PIN
out=(args.output or Path(tempfile.mkdtemp(prefix='ps2-handoff-'))).resolve();out.mkdir(parents=True,exist_ok=True)
originals={}
for name in ['CMakeLists.txt','Source/MailBox.h','Source/MailBox.cpp']:
    data=subprocess.check_output(['git','-C',str(args.play),'show',PIN+':'+name]);originals[name]=data
    target=out/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
shutil.copyfile(NATIVE/'native/CpuTiming.h',out/'Source/CloudCpuTiming.h')
subprocess.run(['python3',str(NATIVE/'patch-handoff.py'),str(out)],check=True)
def macro_off(text):
    active=True;stack=[];result=[]
    for line in text.splitlines(keepends=True):
        if line.strip()=='#ifdef CLOUD_HANDOFF_DIAGNOSTIC':stack.append(active);active=False;continue
        if stack and line.strip()=='#else':active=stack[-1] and not active;continue
        if stack and line.strip()=='#endif':active=stack.pop();continue
        if active:result.append(line)
    assert not stack;return ''.join(result)
for name in ['Source/MailBox.h','Source/MailBox.cpp']:
    assert macro_off((out/name).read_text())==originals[name].decode().replace('\r\n','\n')
for name in ['native/GSH_WebGPU.h','native/CloudRcade.cpp']:
    baseline=subprocess.check_output(['git','-C',str(ROOT),'show','5833a9dfd49144ab768b9f0362036b20d737a2b8:deploy/webrcade/retro-play/'+name],text=True)
    assert macro_off((NATIVE/name).read_text())==baseline,'Original synchronization source changed: '+name
flags=['-std=c++17','-O1','-pthread','-Wall','-Wextra','-Werror','-I'+str(out/'Source')]
source=str(out/'Source/MailBox.cpp');fixture=str(FIXTURE/'mailbox.cpp')
subprocess.run(['c++',*flags,fixture,source,'-o',str(out/'macro-off')],check=True)
subprocess.run([str(out/'macro-off'),'disabled'],check=True)
assert b'CloudHandoff::' not in subprocess.check_output(['nm','-C',str(out/'macro-off')])
diag=['-DCLOUD_HANDOFF_DIAGNOSTIC','-DCLOUD_HANDOFF_TEST_CLOCK=CloudHandoffTestNow','-include',str(FIXTURE/'clock.h')]
subprocess.run(['c++',*flags,*diag,fixture,source,'-o',str(out/'diagnostic')],check=True)
for mode in ['disabled','enabled','toggle','ring']:subprocess.run([str(out/'diagnostic'),mode],check=True)
# Full original macro-off mailbox object, including exception paths, is identical.
subprocess.run(['c++',*flags,'-c',source,'-o',str(out/'off.o')],check=True)
(out/'Source/MailBox.h').write_bytes(originals['Source/MailBox.h']);(out/'Source/MailBox.cpp').write_bytes(originals['Source/MailBox.cpp'])
subprocess.run(['c++',*flags,'-c',source,'-o',str(out/'original.o')],check=True)
assert (out/'off.o').read_bytes()==(out/'original.o').read_bytes()
baseline=out/'baseline-gpu.mjs';baseline.write_bytes(subprocess.check_output(['git','-C',str(ROOT),'show','5833a9dfd49144ab768b9f0362036b20d737a2b8:deploy/webrcade/retro-play/app/gpu.mjs']))
subprocess.run(['node',str(FIXTURE/'host.mjs'),str(baseline)],check=True)
print('PASS actual pinned mailbox source, macro-off object parity, runtime disabled clocks0, toggle/future/FIFO and raw snapshot bounds;',out)
