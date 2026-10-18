#include <cstdint>
#include "MipsJitter.h"
#include "ee/VUShared.h"
#include "MIPS.h"
#include "Jitter_CodeGen_Wasm.h"
#include "MemStream.h"
#include "offsetof_def.h"

static Framework::CMemStream stream;
static const VUShared::FLAG_PIPEINFO* pipes[] = {
    &VUShared::g_pipeInfoMac, &VUShared::g_pipeInfoSticky, &VUShared::g_pipeInfoClip};

extern "C" unsigned layout(unsigned key)
{
    static const unsigned values[] = {
        sizeof(CMIPS), sizeof(MIPSSTATE), offsetof(CMIPS, m_State.pipeTime),
        offsetof(CMIPS, m_State.nGPR[1].nV[0]), offsetof(CMIPS, m_State.nGPR[2].nV[0]),
        offsetof(CMIPS, m_State.nCOP2DF),
        VUShared::g_pipeInfoMac.value, VUShared::g_pipeInfoMac.index,
        VUShared::g_pipeInfoMac.valueArray, VUShared::g_pipeInfoMac.timeArray,
        VUShared::g_pipeInfoSticky.value, VUShared::g_pipeInfoSticky.index,
        VUShared::g_pipeInfoSticky.valueArray, VUShared::g_pipeInfoSticky.timeArray,
        VUShared::g_pipeInfoClip.value, VUShared::g_pipeInfoClip.index,
        VUShared::g_pipeInfoClip.valueArray, VUShared::g_pipeInfoClip.timeArray};
    return key < sizeof(values) / sizeof(*values) ? values[key] : 0;
}

extern "C" uintptr_t generate(unsigned mode, unsigned pipe, uint32 relativeTime)
{
    stream.ResetBuffer();
    CMipsJitter jitter(new Jitter::CCodeGen_Wasm());
    jitter.SetStream(&stream);
    jitter.Begin();
    const auto& info = *pipes[pipe];
    switch(mode)
    {
    case 0:
        VUShared::CheckFlagPipeline(info, &jitter, relativeTime);
        break;
    case 1:
        VUShared::GetStatus(&jitter, offsetof(CMIPS, m_State.nGPR[2].nV[0]), relativeTime);
        break;
    case 2:
        // Consume, queue a new entry, consume before and at its original latency.
        VUShared::CheckFlagPipeline(info, &jitter, relativeTime);
        jitter.PushRel(offsetof(CMIPS, m_State.nGPR[1].nV[0]));
        VUShared::QueueInFlagPipeline(info, &jitter, VUShared::LATENCY_MAC, relativeTime);
        VUShared::CheckFlagPipeline(info, &jitter, relativeTime + 1U);
        VUShared::CheckFlagPipeline(info, &jitter, relativeTime + VUShared::LATENCY_MAC);
        break;
    case 3:
        jitter.PushRel(offsetof(CMIPS, m_State.nGPR[1].nV[0]));
        VUShared::ResetFlagPipeline(info, &jitter);
        VUShared::CheckFlagPipeline(info, &jitter, relativeTime);
        break;
    case 4:
        // All three independently saved rings, including repeated reads.
        for(unsigned i = 0; i < 3; ++i)
            VUShared::CheckFlagPipeline(*pipes[i], &jitter, relativeTime + i);
        for(unsigned i = 0; i < 3; ++i)
            VUShared::CheckFlagPipeline(*pipes[i], &jitter, relativeTime + i + 4U);
        break;
    case 5:
        // Unchanged generation control: queue/reset without a flag read.
        jitter.PushRel(offsetof(CMIPS, m_State.nGPR[1].nV[0]));
        VUShared::QueueInFlagPipeline(info, &jitter, VUShared::LATENCY_MAC, relativeTime);
        jitter.PushRel(offsetof(CMIPS, m_State.nGPR[1].nV[0]));
        VUShared::ResetFlagPipeline(info, &jitter);
        break;
    }
    jitter.End();
    return reinterpret_cast<uintptr_t>(stream.GetBuffer());
}

extern "C" unsigned generatedSize() { return stream.GetSize(); }
