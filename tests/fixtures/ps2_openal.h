// Controlled OpenAL device for executing the actual pinned CSH_OpenAL.cpp.
// The emitted calls are then checked against the shipped Emscripten AL runtime.
#pragma once
#include <cassert>
#include <cstdint>
#include <deque>
#include <iostream>
#include <set>
using int16=int16_t;using uint32=uint32_t;using uint64=uint64_t;
using ALuint=unsigned;using ALint=int;using ALCint=int;
constexpr int AL_INITIAL=4113,AL_PLAYING=4114,AL_STOPPED=4116;
constexpr int AL_BUFFER=4105,AL_BUFFERS_QUEUED=4117,AL_FORMAT_STEREO16=4355,ALC_FREQUENCY=4103,AL_NO_ERROR=0;
struct AudioFixture {
 std::deque<ALuint> queue;std::set<ALuint> buffers;
 int state=AL_INITIAL;unsigned processed=0;double time=0;
 bool clockStalled=false,stallOnData=false;
};
inline AudioFixture audio;
inline void event(const char* op,int a=0,int b=0){std::cout<<op<<" "<<a<<" "<<b<<"\n";}
class CSoundHandler {public:virtual ~CSoundHandler()=default;virtual void Reset()=0;virtual void Write(int16*,unsigned,unsigned)=0;virtual bool HasFreeBuffers()=0;virtual void RecycleBuffers()=0;};
namespace OpenAl {
struct CDevice{};
struct CContext{CContext(CDevice&,ALCint*){} void MakeCurrent(){}};
struct CSource {
 operator ALuint() const{return 1;}
 int GetState(){event("state",audio.state);return audio.state;}
 unsigned GetBuffersProcessed(){event("processed",audio.processed);return audio.processed;}
 void Stop(){if(audio.state!=AL_INITIAL){audio.state=AL_STOPPED;audio.processed=audio.queue.size();}event("stop");}
 void Play(){audio.state=AL_PLAYING;audio.processed=0;event("play");}
};
}
inline void alGetSourcei(ALuint,int param,ALint* value){assert(param==AL_BUFFERS_QUEUED);*value=audio.queue.size();event("queued",*value);}
inline int alGetError(){return 0;}
inline void alGenBuffers(unsigned n,ALuint* ids){for(unsigned i=0;i<n;i++){ids[i]=100+i;assert(audio.buffers.insert(ids[i]).second);}}
inline void alDeleteBuffers(unsigned n,ALuint* ids){assert(audio.queue.empty());for(unsigned i=0;i<n;i++)assert(audio.buffers.erase(ids[i])==1);}
inline void alSourcei(ALuint,int param,int value){assert(param==AL_BUFFER&&value==0);audio.queue.clear();audio.processed=0;event("clear");}
inline void stall(){audio.clockStalled=true;event("stall");}
inline void alBufferData(ALuint id,int format,int16* samples,unsigned size,unsigned rate){assert(format==AL_FORMAT_STEREO16&&size==18000&&rate==44100);assert(audio.buffers.count(id));for(auto queued:audio.queue)assert(queued!=id);event("data",id,samples[0]);if(audio.stallOnData){audio.stallOnData=false;stall();}}
inline void alSourceQueueBuffers(ALuint,unsigned n,ALuint* ids){for(unsigned i=0;i<n;i++){audio.queue.push_back(ids[i]);event("queue",ids[i]);if(audio.clockStalled&&audio.state==AL_PLAYING){audio.processed=audio.queue.size();audio.state=AL_STOPPED;audio.clockStalled=false;}}}
inline void alSourceUnqueueBuffers(ALuint,unsigned n,ALuint* ids){assert(n<=audio.processed);for(unsigned i=0;i<n;i++){ids[i]=audio.queue.front();audio.queue.pop_front();audio.processed--;event("unqueue",ids[i]);}}
inline void drain(){audio.time+=3;audio.processed=audio.queue.size();audio.state=AL_STOPPED;event("drain");}
