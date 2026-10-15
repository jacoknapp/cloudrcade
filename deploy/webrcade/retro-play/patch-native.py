#!/usr/bin/env python3
"""Checked changes to the pinned Play! browser host; run only in build scratch."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
here = Path(__file__).resolve().parent

def edit(name, old, new):
    path = root / name
    text = path.read_text()
    if text.count(old) != 1:
        raise ValueError('Pinned PS2 source changed: ' + name)
    path.write_text(text.replace(old, new))

(root / 'Source/ui_js/Main.cpp').write_bytes((here / 'native/CloudRcade.cpp').read_bytes())
edit('CMakeLists.txt', '${GIT_EXECUTABLE} describe --always', '${GIT_EXECUTABLE} rev-parse --short=12 HEAD')
edit('Source/ui_js/Ps2VmJs.h', '#include "PS2VM.h"', '#include "PS2VM.h"\n#include <atomic>')
edit('Source/ui_js/Ps2VmJs.h', '\tvoid CreateVM() override;', '''\tvoid CreateVM() override;
 std::atomic<int> cloudStatus{1};
 std::string cloudError;
 void CloudPause() {
  cloudStatus = 0;
  PauseAsync();
  m_mailBox.SendCall([this]() { cloudStatus = 1; });
 }
 void CloudResume() {
  cloudStatus = 0;
  m_mailBox.SendCall([this]() { ResumeImpl(); cloudStatus = 1; });
 }''')
for method in ['BootElf', 'BootDiscImage']:
    edit('Source/ui_js/Ps2VmJs.cpp', f'void CPs2VmJs::{method}(std::string path)\n{{',
         f'void CPs2VmJs::{method}(std::string path)\n{{\n cloudError.clear(); cloudStatus = 0;')
path = root / 'Source/ui_js/Ps2VmJs.cpp'
text = path.read_text()
assert text.count('printf("Failed to start: %s.\\r\\n", ex.what());') == 2
text = text.replace('printf("Failed to start: %s.\\r\\n", ex.what());',
                    'cloudError = ex.what(); cloudStatus = -1;')
assert text.count('ResumeImpl();') == 2
path.write_text(text.replace('ResumeImpl();', 'ResumeImpl(); cloudStatus = 1;'))
# Failed/short HTTP reads must terminate the native read, never spin forever or
# pretend bytes past EOF were supplied. The JS device publishes its result first.
edit('Source/Js_DiscImageDeviceStream.cpp', '\tm_position += size;\n\treturn size;', '''
 int result = MAIN_THREAD_EM_ASM_INT({return Module.discImageDevice.result()});
 if(result < 0) throw std::runtime_error("PS2 disc read failed.");
 m_position += result;
 return result;''')
edit('Source/Js_DiscImageDeviceStream.cpp', '\t\tm_position = static_cast<uint64>(positionLo) | (static_cast<uint64>(positionHi) << 32);',
     '\t\tm_position = (static_cast<uint64>(positionLo) | (static_cast<uint64>(positionHi) << 32)) + position;')
edit('Source/Js_DiscImageDeviceStream.cpp', 'bool CJsDiscImageDeviceStream::IsEOF()\n{\n\tthrow std::runtime_error("Not supported.");\n}', '''bool CJsDiscImageDeviceStream::IsEOF()
{
 uint32 lo = MAIN_THREAD_EM_ASM_INT({return Module.discImageDevice.getFileSize()});
 uint32 hi = MAIN_THREAD_EM_ASM_INT({return Module.discImageDevice.getFileSize() / 4294967296});
 return m_position >= (static_cast<uint64>(lo) | (static_cast<uint64>(hi) << 32));
}''')
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sPTHREAD_POOL_SIZE=2")',
     'target_link_options(Play PRIVATE "-sPTHREAD_POOL_SIZE=8")')
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sEXPORT_ES6=1")',
     'target_link_options(Play PRIVATE "-sEXPORT_ES6=1")\ntarget_link_options(Play PRIVATE "-sINITIAL_MEMORY=268435456")')
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sEXPORTED_RUNTIME_METHODS=[\'ccall\', \'FS\']")',
     'target_link_options(Play PRIVATE "-sEXPORTED_RUNTIME_METHODS=[\'ccall\', \'FS\', \'PThread\', \'HEAPU8\']")\n'
     'target_link_options(Play PRIVATE "--post-js=${CMAKE_CURRENT_SOURCE_DIR}/CloudAudio.js")')
(root / 'Source/ui_js/CloudAudio.js').write_text('Module.cloudAudio = () => AL.currentCtx && AL.currentCtx.audioCtx;\n')
edit('Source/ui_js/CMakeLists.txt', "'_main', '_initVm',", "'_main',")
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sUSE_ES6_IMPORT_META=0")', '')
# Compile only the device WebGPU GS frontend, without an OpenGL library/context.
(root / 'Source/ui_js/GSH_WebGPU.h').write_bytes((here / 'native/GSH_WebGPU.h').read_bytes())
path = root / 'Source/ui_js/CMakeLists.txt'
text = path.read_text()
start = text.index('if(NOT TARGET gsh_opengl)')
end = text.index('if(NOT TARGET sh_openal)', start)
text = text[:start] + text[end:]
text = text.replace('\tGSH_OpenGLJs.cpp\n\tGSH_OpenGLJs.h', '\tGSH_WebGPU.h')
text = text.replace('target_link_options(Play PRIVATE "-sOFFSCREEN_FRAMEBUFFER=1")', '')
text = text.replace('target_link_options(Play PRIVATE "-sUSE_WEBGL2=1")', '')
path.write_text(text)

# Snapshot source offsets with the rest of each display circuit (GS-thread safe).
edit('Source/gs/GSHandler.h', '\t\t\tuint32 bufWidth = 0;', '\t\t\tuint32 bufWidth = 0;\n\t\t\tuint32 bufOffsetX = 0, bufOffsetY = 0;')
path = root / 'Source/gs/GSHandler.cpp'
text = path.read_text()
for name in ['dispFb', 'dispFb1', 'dispFb2']:
    old = f'layer.psm = {name}.nPSM;'
    assert text.count(old) == 1
    text = text.replace(old, old + f'\n\t\t\tlayer.bufOffsetX = {name}.nX; layer.bufOffsetY = {name}.nY;')
path.write_text(text)
