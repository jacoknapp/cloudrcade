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
# Bounded native coalescing removes repeated browser crossings for tiny reads.
for name in ['h', 'cpp']:
    (root / ('Source/Js_DiscImageDeviceStream.' + name)).write_bytes(
        (here / ('native/DiscImageDeviceStream.' + name)).read_bytes())
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sPTHREAD_POOL_SIZE=2")',
     'target_link_options(Play PRIVATE "-sPTHREAD_POOL_SIZE=8")')
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sEXPORT_ES6=1")',
     'target_link_options(Play PRIVATE "-sEXPORT_ES6=1")\ntarget_link_options(Play PRIVATE "-sINITIAL_MEMORY=268435456")')
edit('Source/ui_js/CMakeLists.txt', 'target_link_options(Play PRIVATE "-sEXPORTED_RUNTIME_METHODS=[\'ccall\', \'FS\']")',
     'target_link_options(Play PRIVATE "-sEXPORTED_RUNTIME_METHODS=[\'ccall\', \'FS\', \'PThread\', \'HEAPU8\']")\n'
     'target_link_options(Play PRIVATE "--post-js=${CMAKE_CURRENT_SOURCE_DIR}/CloudAudio.js")')
(root / 'Source/ui_js/CloudAudio.js').write_text('Module.cloudAudio = () => AL.currentCtx && AL.currentCtx.audioCtx;\n')
# Restarting a stopped source replays its retained queue. Recycle completed old
# buffers, but protect the freshly appended final buffer: a stalled scheduler
# can count that new PCM as processed before it has ever reached the device.
edit('Source/sound/SH_OpenAL/SH_OpenAL.h',
     'private:\n', 'private:\n\tvoid RecycleBuffers(unsigned int maxBufferCount);\n')
edit('Source/sound/SH_OpenAL/SH_OpenAL.cpp',
     'void CSH_OpenAL::RecycleBuffers()\n{',
     'void CSH_OpenAL::RecycleBuffers()\n{\n\tRecycleBuffers(MAX_BUFFERS);\n}\n\n'
     'void CSH_OpenAL::RecycleBuffers(unsigned int maxBufferCount)\n{')
edit('Source/sound/SH_OpenAL/SH_OpenAL.cpp',
     '\tunsigned int bufferCount = m_source.GetBuffersProcessed();\n\tCHECK_AL_ERROR();',
     '\tunsigned int bufferCount = m_source.GetBuffersProcessed();\n\tCHECK_AL_ERROR();\n'
     '\tif(bufferCount > maxBufferCount) bufferCount = maxBufferCount;')
edit('Source/sound/SH_OpenAL/SH_OpenAL.cpp',
     '\tif(sourceState != AL_PLAYING)\n\t{\n\t\tm_source.Play();',
     '\tif(sourceState != AL_PLAYING)\n\t{\n'
     '\t\tALint queuedBuffers = 0;\n'
     '\t\talGetSourcei(m_source, AL_BUFFERS_QUEUED, &queuedBuffers);\n'
     '\t\tCHECK_AL_ERROR();\n'
     '\t\tRecycleBuffers(queuedBuffers > 0 ? queuedBuffers - 1 : 0);\n'
     '\t\tm_source.Play();')
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

# Keep code-cache hashes bit-identical while enabling upstream's Wasm SIMD
# implementation in the xxhash translation unit only. No other core compiler
# flags change; this pinned SDK selects XXH_NEON via its SIMDe arm_neon.h.
edit('Source/CMakeLists.txt', 'LIST(APPEND PROJECT_LIBS xxHash::xxhash)',
     'LIST(APPEND PROJECT_LIBS xxHash::xxhash)\n'
     'if(EMSCRIPTEN)\n'
     ' target_compile_options(xxhash PRIVATE "-msimd128")\n'
     'endif()')

# Keep the exact page-comparison SIMD isolated from all existing core sources.
for name in ['h', 'cpp']:
    (root / ('Source/CloudInstructionPage.' + name)).write_bytes(
        (here / ('native/CloudInstructionPage.' + name)).read_bytes())
edit('Source/CMakeLists.txt', '\tee/EeExecutor.cpp',
     '\tCloudInstructionPage.cpp\n\tee/EeExecutor.cpp')
with (root / 'Source/CMakeLists.txt').open('a') as stream:
    stream.write('\nif(EMSCRIPTEN)\n set_source_files_properties(CloudInstructionPage.cpp PROPERTIES COMPILE_OPTIONS "-msimd128")\nendif()\n')
edit('Source/ee/EeExecutor.h', '#include <optional>',
     '#include <optional>\n#ifdef __EMSCRIPTEN__\n#include "../CloudInstructionPage.h"\n#endif')

# Browsers cannot protect EE RAM pages to catch writes to compiled code. Games
# replace executable overlays and call FlushCache before running the new code.
# Compare only active instruction ranges at that safe point; unchanged blocks
# keep their compiled functions and lookup entries.
edit('Source/ee/EeExecutor.h', '\tvoid Reset() override;', '''#ifdef __EMSCRIPTEN__
 void SyncInstructionCache();
#endif
\tvoid Reset() override;''')
edit('Source/ee/EeExecutor.h', '\tCachedBlockMap m_cachedBlocks;', '''\tCachedBlockMap m_cachedBlocks;
#ifdef __EMSCRIPTEN__
 struct InstructionPage {
  uint128 hash = {};
  std::unique_ptr<CloudInstructionPage> snapshot;
  std::set<uint32> entries;
 };
 std::map<uint32, uint128> m_instructionHashes;
 std::map<uint32, InstructionPage> m_instructionPages;
 // Bound extra host memory on phones; all remaining pages retain page hashes.
 static constexpr uint32 MAX_INSTRUCTION_SNAPSHOTS = 512;
 uint32 m_instructionSnapshotCount = 0;
#endif''')
edit('Source/ee/EeExecutor.cpp', '\tm_cachedBlocks.clear();', '''\tm_cachedBlocks.clear();
#ifdef __EMSCRIPTEN__
 m_instructionHashes.clear();
 m_instructionPages.clear();
 m_instructionSnapshotCount = 0;
#endif''')
edit('Source/ee/EeExecutor.cpp', '\tmemcpy(&hash, &xxHash, sizeof(xxHash));', '''\tmemcpy(&hash, &xxHash, sizeof(xxHash));
#ifdef __EMSCRIPTEN__
 if(end < PS2::EE_RAM_SIZE) {
  m_instructionHashes[start] = hash;
  for(uint32 page = start & ~0xFFF; page <= (end & ~0xFFF); page += 0x1000) {
   auto found = m_instructionPages.find(page);
   if(found == m_instructionPages.end()) {
    InstructionPage entry;
    if(m_instructionSnapshotCount < MAX_INSTRUCTION_SNAPSHOTS) {
     entry.snapshot = std::make_unique<CloudInstructionPage>();
     entry.snapshot->Assign(m_ram + page);
     ++m_instructionSnapshotCount;
    } else {
     const auto actual = XXH3_128bits(m_ram + page, 0x1000);
     memcpy(&entry.hash, &actual, sizeof(actual));
    }
    found = m_instructionPages.emplace(page, std::move(entry)).first;
   }
   found->second.entries.insert(start);
  }
 }
#endif''')
edit('Source/ee/EeExecutor.cpp',
     '\tCGenericMipsExecutor::ClearActiveBlocksInRange(start, end, executing);',
     '\tCGenericMipsExecutor::ClearActiveBlocksInRange(start, end, executing);' + '''
#ifdef __EMSCRIPTEN__
 const uint32 first = start > MAX_BLOCK_SIZE ? start - MAX_BLOCK_SIZE : 0;
 for(auto it = m_instructionHashes.lower_bound(first); it != m_instructionHashes.end() && it->first <= end;)
 {
  if(!HasBlockAt(it->first)) it = m_instructionHashes.erase(it);
  else ++it;
 }
 const uint32 last = std::min<uint32>(PS2::EE_RAM_SIZE - 1, end + MAX_BLOCK_SIZE);
 for(auto it = m_instructionPages.lower_bound(first & ~0xFFF); it != m_instructionPages.end() && it->first <= last;)
 {
  auto& entries = it->second.entries;
  for(auto entry = entries.begin(); entry != entries.end();)
  {
   if(!HasBlockAt(*entry)) entry = entries.erase(entry);
   else ++entry;
  }
  if(entries.empty()) {
   if(it->second.snapshot) --m_instructionSnapshotCount;
   it = m_instructionPages.erase(it);
  } else ++it;
 }
#endif''')
with (root / 'Source/ee/EeExecutor.cpp').open('a') as stream:
    stream.write('''
#ifdef __EMSCRIPTEN__
void CEeExecutor::SyncInstructionCache()
{
 std::vector<std::pair<uint32, uint32>> changed;
 // Every flush still checks every compiled page, covering direct generated
 // stores, DMA and HLE writes without write hooks. Bounded exact copies avoid
 // hashing unchanged pages; excess pages use the existing hash filter.
 for(auto& pair : m_instructionPages)
 {
  auto& page = pair.second;
  uint128 hash;
  if(page.snapshot) {
   if(page.snapshot->Equals(m_ram + pair.first)) continue;
   page.snapshot->Assign(m_ram + pair.first);
  } else {
   const auto actual = XXH3_128bits(m_ram + pair.first, 0x1000);
   memcpy(&hash, &actual, sizeof(actual));
   if(page.hash == hash) continue;
   page.hash = hash;
  }
  for(const auto start : page.entries)
  {
   const auto* block = FindBlockStartingAt(start);
   if(block->IsEmpty()) continue;
   const auto end = block->GetEndAddress();
   const auto found = m_instructionHashes.find(start);
   const auto actual = XXH3_128bits(m_ram + start, end - start + 4);
   memcpy(&hash, &actual, sizeof(actual));
   if(found == m_instructionHashes.end() || !(found->second == hash))
    changed.emplace_back(start, end + 4);
  }
 }
 // Merge overlaps before unlinking, including blocks spanning a changed range.
 std::sort(changed.begin(), changed.end());
 for(size_t i = 0; i < changed.size();)
 {
  auto range = changed[i++];
  while(i < changed.size() && changed[i].first <= range.second)
   range.second = std::max(range.second, changed[i++].second);
  ClearActiveBlocksInRange(range.first, range.second, false);
 }

}
#endif
''')
edit('Source/ee/PS2OS.cpp',
     '\tFRAMEWORK_MAYBE_UNUSED uint32 operationType = m_ee.m_State.nGPR[SC_PARAM0].nV[0];',
     '''\tFRAMEWORK_MAYBE_UNUSED uint32 operationType = m_ee.m_State.nGPR[SC_PARAM0].nV[0];
#ifdef __EMSCRIPTEN__
 static_cast<CEeExecutor*>(m_ee.m_executor.get())->SyncInstructionCache();
#endif''')

# Snapshot source offsets with the rest of each display circuit (GS-thread safe).
edit('Source/gs/GSHandler.h', '\t\t\tuint32 bufWidth = 0;', '\t\t\tuint32 bufWidth = 0;\n\t\t\tuint32 bufOffsetX = 0, bufOffsetY = 0;')
path = root / 'Source/gs/GSHandler.cpp'
text = path.read_text()
for name in ['dispFb', 'dispFb1', 'dispFb2']:
    old = f'layer.psm = {name}.nPSM;'
    assert text.count(old) == 1
    text = text.replace(old, old + f'\n\t\t\tlayer.bufOffsetX = {name}.nX; layer.bufOffsetY = {name}.nY;')
path.write_text(text)

# Movie code generation and opt-in CPU timing diagnostics have separate ownership.
import subprocess
subprocess.run([sys.executable, str(here / 'patch-movie.py'), str(root)], check=True)
subprocess.run([sys.executable, str(here / 'patch-cpu-timing.py'), str(root)], check=True)
subprocess.run([sys.executable, str(here / 'patch-gs-registers.py'), str(root)], check=True)
subprocess.run([sys.executable, str(here / 'patch-gs-readback.py'), str(root)], check=True)

# Install pending-validation and exact sparse snapshots after baseline helpers.
subprocess.run([sys.executable, str(here / 'patch-coherence-sparse16.py'), str(root)], check=True)
