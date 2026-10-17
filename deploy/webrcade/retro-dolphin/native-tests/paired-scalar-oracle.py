"""Build a narrow actual Interpreter_Paired operand-ordering oracle.

The four function bodies are extracted unchanged from the pinned source.
Finite arithmetic shims are used only with small exact binary inputs, no flags,
NaNs, traps, underflow or fused-rounding edge cases. This validates alias ordering,
not the interpreter's complete floating-point/status contract.
"""
from pathlib import Path
import subprocess
import hashlib

def build(source, output, extract_function):
    paired_bytes=(source/'vendor/dolphin/Source/Core/Core/PowerPC/Interpreter/Interpreter_Paired.cpp').read_bytes()
    assert hashlib.sha256(paired_bytes).hexdigest()=='7bc724e02d4341ffd1e556cfcb613288158a1d4e30255fcd68b5d796ac9417c6', 'pinned interpreter checksum mismatch'
    paired=paired_bytes.decode()
    cpp='''#include <array>
#include <bit>
#include <cmath>
#include <cassert>
#include <fstream>
#include <filesystem>
#include <string>
#include "Core/PowerPC/Gekko.h"
struct Paired { double lane[2]{}; double PS0AsDouble()const{return lane[0];}
double PS1AsDouble()const{return lane[1];} void SetBoth(float a,float b){lane[0]=a;lane[1]=b;} };
struct State { Paired ps[32]; int fpscr=0; void UpdateFPRFSingle(float){} void UpdateCR1(){} };
struct Interpreter { State m_ppc_state;
static void ps_muls0(Interpreter&,UGeckoInstruction);
static void ps_muls1(Interpreter&,UGeckoInstruction);
static void ps_madds0(Interpreter&,UGeckoInstruction);
static void ps_madds1(Interpreter&,UGeckoInstruction); };
struct Result { double value; };
double Force25Bit(double v){assert((std::bit_cast<u64>(v)&0x7ffffff)==0);return v;}
float ForceSingle(int,double v){assert(std::isfinite(v)&&std::abs(v)<1e15);return static_cast<float>(v);}
Result NI_mul(State&,double a,double b){return {a*b};}
template<bool> Result NI_madd(State&,double a,double c,double b){return {std::fma(a,c,b)};}
'''
    for name in ['ps_muls0','ps_muls1','ps_madds0','ps_madds1']:
        cpp+=extract_function(paired,'Interpreter::'+name)
    cpp+='''int main(int argc,char**argv){
std::filesystem::create_directories(argv[1]);
std::ifstream input(argv[2]); std::string name;unsigned count;
while(input>>name>>count){
 std::array<u32,16> words{};assert(count<=16);
 for(unsigned i=0;i<count;++i)input>>std::hex>>words[i]>>std::dec;
 for(int vector=0;vector<6;++vector){
  Interpreter cpu;
  const double scale=vector<3 ? (1.0/(1<<vector)) : (-1.0/(1<<(vector-3)));
  for(int r=0;r<32;++r){cpu.m_ppc_state.ps[r].lane[0]=(r%3+1)*scale;cpu.m_ppc_state.ps[r].lane[1]=(r%4+1)*scale;}
  for(unsigned i=0;i<count;++i){UGeckoInstruction inst(words[i]);
   switch(inst.SUBOP5){case 12:Interpreter::ps_muls0(cpu,inst);break;case 13:Interpreter::ps_muls1(cpu,inst);break;
    case 14:Interpreter::ps_madds0(cpu,inst);break;case 15:Interpreter::ps_madds1(cpu,inst);break;default:assert(false);}}
  std::ofstream out(std::string(argv[1])+"/"+name+"-"+std::to_string(vector)+".bin",std::ios::binary);
  out.write(reinterpret_cast<const char*>(cpu.m_ppc_state.ps),sizeof(cpu.m_ppc_state.ps));
 }
}}
'''
    target=output/'paired-scalar-oracle.cpp'; target.write_text(cpp)
    exe=output/'paired-scalar-oracle'
    subprocess.run(['g++','-std=c++20','-O2','-I'+str(source/'vendor/dolphin/Source/Core'),'-I'+str(source/'vendor/dolphin/Externals/fmt/fmt/include'),str(target),'-o',str(exe)],check=True)
    subprocess.run([str(exe),str(output/'oracle'),str(Path(__file__).parent/'paired-scalar-cases.txt')],check=True)
