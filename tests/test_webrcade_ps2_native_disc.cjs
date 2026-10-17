/* Compile the actual buffered native stream with a synthetic browser bridge. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../deploy/webrcade/retro-play/native'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps2-native-disc-'));
try{
 fs.copyFileSync(path.join(root,'DiscImageDeviceStream.h'),path.join(dir,'Js_DiscImageDeviceStream.h'));
 fs.writeFileSync(path.join(dir,'Stream.h'),`#pragma once
#include <cstdint>
using uint8=uint8_t;using uint32=uint32_t;using uint64=uint64_t;using int64=int64_t;
namespace Framework {enum STREAM_SEEK_DIRECTION {STREAM_SEEK_SET,STREAM_SEEK_END,STREAM_SEEK_CUR};class CStream {public:virtual ~CStream()=default;virtual void Seek(int64,STREAM_SEEK_DIRECTION)=0;virtual uint64 Tell()=0;virtual uint64 Read(void*,uint64)=0;virtual uint64 Write(const void*,uint64)=0;virtual bool IsEOF()=0;virtual void Flush()=0;};}
`);
 fs.writeFileSync(path.join(dir,'emscripten.h'),`#pragma once
#include <cstdint>
void testRead(void*,uint32_t,uint32_t,uint32_t);int testInt(const char*);double testSize();
#define MAIN_THREAD_EM_ASM(code,...) testRead(__VA_ARGS__)
#define MAIN_THREAD_EM_ASM_INT(code) testInt(#code)
#define MAIN_THREAD_EM_ASM_DOUBLE(code) testSize()
`);
 fs.writeFileSync(path.join(dir,'test.cpp'),`#include "Js_DiscImageDeviceStream.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>
static uint64 discSize=5ULL*1024*1024*1024+123;static unsigned reads=0,sizes=0,results=0,polls=0;static int result=0,error=0;static bool delayed=false;
void testRead(void* buffer,uint32 lo,uint32 hi,uint32 length){auto offset=uint64(lo)+(uint64(hi)<<32);assert(length<=2*1024*1024);assert(offset+length<=discSize);reads++;auto* bytes=static_cast<uint8*>(buffer);for(uint32 i=0;i<length;i++)bytes[i]=(offset+i)%251;result=error==-99?0:error?error:int(length);polls=0;}
int testInt(const char* source){if(std::strstr(source,"isDone"))return !delayed||++polls>=3;if(std::strstr(source,"result")){results++;return result;}throw std::runtime_error("Unexpected bridge call");}
double testSize(){sizes++;return double(discSize);}
void verify(CJsDiscImageDeviceStream& disc,uint64 offset,unsigned length){disc.Seek(offset,Framework::STREAM_SEEK_SET);std::vector<uint8> out(length+16,255);auto expected=offset>=discSize?0:std::min<uint64>(length,discSize-offset);auto count=disc.Read(out.data()+8,length);assert(count==expected);assert(disc.Tell()==offset+expected);for(unsigned i=0;i<count;i++)assert(out[8+i]==(offset+i)%251);for(unsigned i=0;i<8;i++)assert(out[i]==255);for(unsigned i=8+count;i<out.size();i++)assert(out[i]==255);}
int main(){CJsDiscImageDeviceStream disc;assert(disc.Read(nullptr,0)==0&&sizes==0&&reads==0);for(unsigned i=0;i<512;i++)verify(disc,i*2048,2048);assert(reads==16&&results==16&&sizes==1);std::cout<<"512 sector reads -> "<<reads<<" browser requests (32x fewer),64KiB native buffer\\n";
 verify(disc,65536-3,10);auto before=reads;verify(disc,65536+10,16);assert(reads==before);disc.Seek(-10,Framework::STREAM_SEEK_CUR);assert(disc.Tell()==65536+16);
 verify(disc,(1ULL<<32)+65536-3,10);verify(disc,discSize-3,20);assert(disc.IsEOF());verify(disc,discSize,20);verify(disc,discSize+100,20);assert(disc.IsEOF());disc.Seek(-3,Framework::STREAM_SEEK_END);assert(disc.Tell()==discSize-3);before=reads;verify(disc,123,200000);assert(reads==before+1);verify(disc,0,3*1024*1024);
 delayed=true;verify(disc,3*1024*1024,2048);delayed=false;
 for(int bad:{-99,-1,1,65537}){error=bad;disc.Seek(20*1024*1024,Framework::STREAM_SEEK_SET);bool threw=false;try{uint8 out[16];disc.Read(out,16);}catch(const std::runtime_error&){threw=true;}assert(threw);error=0;verify(disc,20*1024*1024,16);verify(disc,0,16);}
 bool readonly=false;try{disc.Write(nullptr,1);}catch(const std::runtime_error&){readonly=true;}assert(readonly);disc.Flush();std::cout<<"PASS actual native stream >4GiB,SEEK_END,EOF,unaligned/multi-buffer copies,error recovery,read-only and completion polling\\n";}
`);
 const exe=path.join(dir,'test');execFileSync('g++',['-std=c++17','-O2','-Wall','-Wextra','-Werror','-I'+dir,path.join(root,'DiscImageDeviceStream.cpp'),path.join(dir,'test.cpp'),'-o',exe],{stdio:'inherit'});
 execFileSync(exe,[],{stdio:'inherit'});
}finally{fs.rmSync(dir,{recursive:true,force:true});}
