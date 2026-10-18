#include <cstdint>
#include "MipsJitter.h"
#include "ee/VUShared.h"
#include "MIPS.h"
#include "Jitter_CodeGen_Wasm.h"
#include "MemStream.h"
#include "offsetof_def.h"

static Framework::CMemStream stream;
extern "C" unsigned layout(unsigned key)
{
    static const unsigned values[]={sizeof(CMIPS),sizeof(MIPSSTATE),
        offsetof(CMIPS,m_State.nCOP2),offsetof(CMIPS,m_State.nCOP2A),
        offsetof(CMIPS,m_State.pipeMac.index),offsetof(CMIPS,m_State.pipeSticky.index),
        offsetof(CMIPS,m_State.pipeClip.index),offsetof(CMIPS,m_State.pipeTime),
        offsetof(CMIPS,m_State.pipeMac.values),offsetof(CMIPS,m_State.pipeSticky.values),
        offsetof(CMIPS,m_State.pipeMac.pipeTimes),offsetof(CMIPS,m_State.pipeSticky.pipeTimes)};
    return key<sizeof(values)/sizeof(*values)?values[key]:0;
}
extern "C" uintptr_t generate(unsigned op,unsigned mask,unsigned alias,unsigned hints,unsigned count)
{
    stream.ResetBuffer();
    CMipsJitter jitter(new Jitter::CCodeGen_Wasm());
    jitter.SetStream(&stream);
    jitter.Begin();
    uint8 fd=3,fs=1,ft=2;
    if(alias==1)fd=fs;
    if(alias==2)fd=ft;
    if(alias==3)fd=0;
    if(alias==4)ft=fs;
    if(alias==5)fs=0;
    if(alias==6)ft=0;
    for(unsigned i=0;i<count;i++)
    {
        const unsigned time=i*3;
        switch(op)
        {
        case 0:VUShared::ADD(&jitter,mask,fd,fs,ft,time,hints);break;
        case 1:VUShared::ADDA(&jitter,mask,fs,ft,time,hints);break;
        case 2:VUShared::MADD(&jitter,mask,fd,fs,ft,time,hints);break;
        case 3:VUShared::MADDA(&jitter,mask,fs,ft,time,hints);break;
        case 4:VUShared::SUB(&jitter,mask,fd,fs,ft,time,hints);break;
        case 5:VUShared::SUBA(&jitter,mask,fs,ft,time,hints);break;
        case 6:VUShared::MSUB(&jitter,mask,fd,fs,ft,time,hints);break;
        case 7:VUShared::MSUBA(&jitter,mask,fs,ft,time,hints);break;
        case 8:VUShared::MUL(&jitter,mask,fd,fs,ft,time,hints);break;
        case 9:VUShared::MULA(&jitter,mask,fs,ft,time,hints);break;
        case 10:VUShared::ADDbc(&jitter,mask,fd,fs,0,0,time,hints);break;
        case 11:VUShared::MULbc(&jitter,mask,fd,fs,ft,2,time,hints);break;
        case 12:VUShared::ADDi(&jitter,mask,fd,fs,time,hints);break;
        case 13:VUShared::OPMSUB(&jitter,fd,fs,ft,time,hints);break;
        }
    }
    jitter.End();
    return reinterpret_cast<uintptr_t>(stream.GetBuffer());
}
extern "C" unsigned generatedSize(){return stream.GetSize();}
