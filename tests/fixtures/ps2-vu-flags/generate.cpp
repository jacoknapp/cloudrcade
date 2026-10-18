#include <cstdint>
#include "Jitter.h"
#include "Jitter_CodeGen_Wasm.h"
#include "MemStream.h"

static Framework::CMemStream stream;
extern "C" uintptr_t generate(unsigned kind, unsigned count)
{
    stream.ResetBuffer();
    Jitter::CJitter jitter(new Jitter::CCodeGen_Wasm());
    jitter.SetStream(&stream);
    jitter.Begin();
    for(unsigned i = 0; i < count; i++)
    {
        const unsigned base = i * 64;
        jitter.MD_PushRel(base + (kind == 3 ? 3 : 0));
        if(kind == 1)
        {
            jitter.MD_PushCstExpandW(0x80808080);
            jitter.MD_Xor();
        }
        jitter.MD_MakeSignZero();
        jitter.PullRel(base + (kind == 2 ? 0 : kind == 3 ? 23 : 16));
    }
    jitter.End();
    return reinterpret_cast<uintptr_t>(stream.GetBuffer());
}
extern "C" unsigned generatedSize() { return stream.GetSize(); }
