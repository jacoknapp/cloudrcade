#!/usr/bin/env python3
"""Extract the pinned real emitter and compare cached versus reference Wasm.

Inputs: --source reconstructed pinned native tree, --candidate patched native
CachedInterpreter.cpp, --output empty scratch directory. Needs g++ and Node.
No native source/artifact/cache is modified. This is a small emitter fixture,
not a substitute for a full native/game qualification.
"""
import argparse
import json
import hashlib
import pathlib
import subprocess
import shutil
import importlib.util
import sys
sys.dont_write_bytecode = True

HERE = pathlib.Path(__file__).resolve().parent
PPC = 'vendor/dolphin/Source/Core/Core/PowerPC/CachedInterpreter/CachedInterpreter.cpp'
BASE_SHA = '1120ca03266f7d528662c3bf5a55e822bfe6fc25499c6a031ada1212d33fe15c'

def function(source, name):
    import re
    match = re.search(r'^.*\b' + name + r'\([^;]*?\n\{\n', source, re.M)
    if not match:
        raise ValueError('missing function ' + name)
    end = source.index('\n}', match.end()) + 2
    return source[match.start():end] + '\n'

def between(source, first, last):
    return source[source.index(first):source.index(last)]

def extract(source, cached):
    pieces = ['''#include <array>
#include <vector>
#include <string>
#include <string_view>
#include <span>
#include <fstream>
#include <filesystem>
#include <unordered_map>
#include "Common/BitSet.h"
#include "Core/PowerPC/Gekko.h"
namespace GPFifo { constexpr u32 GATHER_PIPE_EXTRA_SIZE=64, GATHER_PIPE_SIZE=32; }
namespace PowerPC { struct PairedSingle { u64 bits[2]; }; }
struct Info { u32 num_cycles = 1; }; static Info info;
namespace PPCAnalyst { struct CodeOp { UGeckoInstruction inst; const Info* opinfo = &info;
u32 address = 0; BitSet32 regsIn, regsOut; bool skip = false, canEndBlock = false; }; }
constexpr u32 DOLPHIN_WEB_DISABLE_REGALLOC = 1;
bool disable_regalloc = false;
bool DolphinWebHelperDisabled(u32) { return disable_regalloc; }
u32 s_wasm_emit_state_load_u32_count, s_wasm_emit_state_store_u32_count;
u32 s_wasm_emit_state_load_f64_count, s_wasm_emit_state_store_f64_count;
u32 s_wasm_emit_state_load_i64_count, s_wasm_emit_state_store_i64_count;
u32 s_wasm_block_emit_fail_count, s_wasm_emit_fail_key_counts[65536], s_wasm_emit_fail_sample_pcs[65536];
void AnalyzeFastmemHoistability(std::span<const PPCAnalyst::CodeOp>) {}
void AnalyzeFastmemHoistPlan(std::span<const PPCAnalyst::CodeOp>) {}
#define DOLPHIN_WASM_MEMORY_PAGES 1
''']
    for name in ['EmitU32Leb', 'EmitI32Leb', 'EmitSection', 'EmitName', 'EmitEnvFunctionImport']:
        pieces.append(function(source, name))
    # EmitSection has a second initializer_list overload.
    pieces.append('void EmitSection(std::vector<u8>& b,u8 i,std::initializer_list<u8> c) { EmitSection(b,i,std::span<const u8>(c.begin(),c.size())); }\n')
    pieces.append(between(source, 'struct WasmStateLayout', '// ─── §28cx C1'))
    pieces.append(between(source, 'constexpr u32 WASM_GPR_LOCAL_BASE', '// §28cz fastmem bounds-check hoist plan.'))
    pieces.append('constexpr u32 WASM_FMH_FLAG_LOCAL = 40; struct { bool active=false; std::unordered_map<const PPCAnalyst::CodeOp*, int> ops; } s_fmh_plan;\n')
    for name in ['RegCacheGprIndex', 'EmitRegCacheFlushDirty', 'EmitRegCacheReloadAll', 'EmitRegCacheReloadMask',
                 'EmitI32Const', 'PsOffset', 'EmitStateLoadU32', 'EmitStateLoadF64', 'EmitStateLoadI64',
                 'EmitStateStoreU32Prefix', 'EmitStateStoreF64Suffix', 'EmitStateStoreI64Suffix',
                 'EmitImportedHaltCheck', 'EmitInterpretCall', 'EmitFpCall', 'EmitFpuAvailableOrFallback',
                 'EmitPairedSingleMerge', 'EmitPairedSingleAddSub', 'EmitPairedSingleMulAddSub',
                 'EmitPairedSingleScalarMulAdd', 'IsPairedSingleMergeSubop', 'IsPairedSingleArithmeticSubop',
                 'IsSinglePrecisionArithmeticSubop', 'IsDoublePrecisionArithmeticSubop',
                 'EmitSinglePrecisionArithmetic', 'EmitDoublePrecisionArithmetic', 'EmitFrsp']:
        pieces.append(function(source, name))
    if cached:
        pieces.append(function(source, 'CountFprCacheLaneUses'))
        pieces.append(function(source, 'BeginFprCacheRun'))
    pieces.append('''void EmitStateStoreU32Suffix(std::vector<u8>& b,u32 o) { b.push_back(0x36); b.push_back(2); EmitU32Leb(b,o); }
bool EmitWasmSupportedIntegerInstruction(std::vector<u8>& b, const WasmStateLayout& l,const PPCAnalyst::CodeOp& op,u32 d) {
  auto i=op.inst;
  if(i.Rc) return false;
  if(i.OPCD==4 && IsPairedSingleMergeSubop(i.SUBOP10)) EmitPairedSingleMerge(b,l,op,d);
  else if(i.OPCD==4 && IsPairedSingleArithmeticSubop(i.SUBOP5)) {
    if(i.SUBOP5>=12 && i.SUBOP5<=15) EmitPairedSingleScalarMulAdd(b,l,op,d);
    else if(i.SUBOP5==20 || i.SUBOP5==21) EmitPairedSingleAddSub(b,l,op,d);
    else EmitPairedSingleMulAddSub(b,l,op,d);
  } else if(i.OPCD==59 && IsSinglePrecisionArithmeticSubop(i.SUBOP5)) EmitSinglePrecisionArithmetic(b,l,op,d);
  else if(i.OPCD==63 && IsDoublePrecisionArithmeticSubop(i.SUBOP5)) EmitDoublePrecisionArithmetic(b,l,op,d);
  else if(i.OPCD==63 && i.SUBOP10==12) EmitFrsp(b,l,op,d);
  else if(i.OPCD==63 && i.SUBOP10==72) {
    EmitFpuAvailableOrFallback(b,op,l,d); EmitStateStoreU32Prefix(b); EmitStateLoadI64(b,PsOffset(l,i.FB,0));
    EmitStateStoreI64Suffix(b,PsOffset(l,i.FD,0)); b.push_back(5); EmitFpCall(b,op,d); b.push_back(0x0b);
  } else return false;
  return true;
}
''')
    pieces.append(function(source, 'BuildWasmCachedInterpreterBlock'))
    pieces.append('''int main(int argc,char**argv) {
  disable_regalloc = argc > 3;
  std::filesystem::create_directories(argv[1]);
  std::ifstream input(argv[2]); unsigned count; std::string name;
  WasmStateLayout l{}; l.ps_offset=256; l.msr_offset=16; l.npc_offset=20;
  while(input>>name>>count) {
    std::vector<PPCAnalyst::CodeOp> ops(count); unsigned index=0;
    for(auto& op:ops) { input>>std::hex>>op.inst.hex>>std::dec; op.address=0x80003000+4*index++; }
    auto bytes=BuildWasmCachedInterpreterBlock(ops,l,0x80004000,true,true);
    std::ofstream out(std::string(argv[1])+"/"+name+".wasm",std::ios::binary);
    out.write(reinterpret_cast<const char*>(bytes.data()),bytes.size());
  }
}
''')
    return '\n'.join(pieces)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=pathlib.Path,required=True)
    p.add_argument('--candidate',type=pathlib.Path)
    p.add_argument('--output',type=pathlib.Path,required=True)
    a=p.parse_args(); a.output.mkdir(parents=True,exist_ok=True)
    original=(a.source/PPC).read_bytes()
    assert hashlib.sha256(original).hexdigest()==BASE_SHA, 'pinned emitter checksum mismatch'
    if a.candidate is None:
        candidate_root=a.output/'candidate-source'
        header='vendor/dolphin/Source/Core/Core/WasmTimingProfile.h'
        for relative in [PPC, header]:
            target=candidate_root/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(a.source/relative,target)
        subprocess.run(['git','apply',str(HERE.parent/'native-patches/0010-fpr-locals-and-slice-totals.patch')],cwd=candidate_root/'vendor/dolphin',check=True)
        subprocess.run(['git','apply',str(HERE.parent/'native-patches/0013-snapshot-paired-scalar.patch')],cwd=candidate_root/'vendor/dolphin',check=True)
        a.candidate=candidate_root/PPC
    for variant, source in [('reference',original.decode()),('cached',a.candidate.read_text())]:
        cpp=a.output/(variant+'.cpp'); cpp.write_text(extract(source,variant=='cached'))
        exe=a.output/(variant+'-emit')
        subprocess.run(['g++','-std=c++20','-O2','-I'+str(a.source/'vendor/dolphin/Source/Core'),'-I'+str(a.source/'vendor/dolphin/Externals/fmt/fmt/include'),str(cpp),'-o',str(exe)],check=True)
        subprocess.run([str(exe),str(a.output/variant),str(HERE/'fpr-cases.txt')],check=True)
        subprocess.run([str(exe),str(a.output/(variant+'-aliases')),str(HERE/'paired-scalar-cases.txt')],check=True)
        if variant=='cached':
            subprocess.run([str(exe),str(a.output/'disabled'),str(HERE/'fpr-cases.txt'),'disabled'],check=True)
            subprocess.run([str(exe),str(a.output/'disabled-aliases'),str(HERE/'paired-scalar-cases.txt'),'disabled'],check=True)
    spec=importlib.util.spec_from_file_location('paired_scalar_oracle',HERE/'paired-scalar-oracle.py')
    oracle=importlib.util.module_from_spec(spec); spec.loader.exec_module(oracle)
    oracle.build(a.source,a.output,function)
    subprocess.run(['node',str(HERE/'fpr-locals.mjs'),str(a.output)],check=True)
    api_source = """#define __EMSCRIPTEN__ 1
#define EMSCRIPTEN_KEEPALIVE
#include "WasmTimingProfile.h"
#include <sstream>
#include <string>
#include <cassert>
#include <iostream>
bool s_ppc_block_profile_enabled=false;
std::atomic<bool> s_ppc_timing_requested{false},s_slice_timing_requested{false};
void ResetPpcBlockProfile(){}
"""
    for name in ['SetPpcProfileEnabled', 'SetSliceTimingEnabled', 'GetSliceTimingTotals']:
        api_source += function(a.candidate.read_text(), name)
    api_source += """int main(){
using namespace DolphinWeb::WasmTimingProfile;
SetSliceTimingEnabled(1); assert(!s_ppc_block_profile_enabled);
assert(BeginSlice()); RecordCompileUs(3); FinishSlice(10,6,4);
SetPpcProfileEnabled(1); SetSliceTimingEnabled(0);
assert(s_enabled.load());
SetPpcProfileEnabled(0); assert(!s_enabled.load());
std::cout<<GetSliceTimingTotals()<<"\\n";
}
"""
    api_cpp=a.output/'timing-api.cpp'; api_cpp.write_text(api_source)
    # Header was independently patched into scratch; --candidate mode uses the
    # matching sibling header supplied by the caller.
    header_dir=a.candidate.parent if a.candidate.parent.name!='CachedInterpreter' else a.candidate.parents[2]
    api_exe=a.output/'timing-api'
    subprocess.run(['g++','-std=c++20','-O2','-pthread','-I'+str(header_dir),str(api_cpp),'-o',str(api_exe)],check=True)
    api=json.loads(subprocess.check_output([str(api_exe)],text=True))
    assert api==dict(v=1,enabled=False,epoch=2,slices=1,totalUs=10,advanceInclUs=6,executeInclUs=4,compileSubsetUs=3,throttleBlockedSubsetUs=0,dvdBlockedSubsetUs=0),api
    print('timing ABI: pass (lightweight opt-in, PPC profile coexistence, epoch, JSON fields)')


if __name__=='__main__': main()
