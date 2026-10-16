#include "sound/SH_OpenAL/SH_OpenAL.h"
#include <string>
int main(int argc,char** argv){
 const bool baseline=argc>1&&std::string(argv[1])=="baseline";
 CSH_OpenAL handler;int16 samples[9000]={};
 auto write=[&](int marker){samples[0]=marker;handler.Write(samples,9000,44100);};
 assert(handler.GetFreeBufferCount()==25);
 // Ten queued chunks: audible once, then starvation before proxy recycling.
 for(int i=1;i<=10;i++)write(i);
 assert(handler.GetFreeBufferCount()==15);drain();
 write(11);assert(handler.GetFreeBufferCount()==(baseline?14:24));drain();
 handler.RecycleBuffers();assert(handler.GetFreeBufferCount()==25);
 // Repeated underruns must neither double-return a buffer nor lose fresh PCM.
 for(int i=12;i<=20;i++){write(i);drain();}
 handler.RecycleBuffers();assert(handler.GetFreeBufferCount()==25);
 // Reset discards the previous queue once and restores the complete allocator.
 write(41);handler.Reset();assert(handler.GetFreeBufferCount()==25);
 write(42);drain();handler.RecycleBuffers();assert(handler.GetFreeBufferCount()==25);
 handler.Reset();assert(handler.GetFreeBufferCount()==25);
}
