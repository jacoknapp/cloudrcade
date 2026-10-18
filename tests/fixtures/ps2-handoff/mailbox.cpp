// Compiles the real pinned mailbox with macro off, runtime off, on and toggle.
#include "MailBox.h"
#include <thread>
#include <atomic>
#include <vector>
#include <future>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>
static std::atomic<unsigned> clockCalls{0};
double CloudHandoffTestNow(){++clockCalls;return std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
template<class F> void until(F fn){
 const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(5);
 while(!fn()){if(std::chrono::steady_clock::now()>end)throw std::runtime_error("fixture timeout");std::this_thread::yield();}
}
#ifdef CLOUD_HANDOFF_DIAGNOSTIC
static bool has(CloudHandoff::Kind kind){
 for(uint32_t i=0;i<CloudHandoff::Reserved();++i){auto& e=CloudHandoff::Events()[i];if(e.ready.load(std::memory_order_acquire)&&e.kind==kind)return true;}return false;
}
#endif
int main(int argc,char** argv){
 const std::string mode=argc>1?argv[1]:"disabled";
#ifdef CLOUD_HANDOFF_DIAGNOSTIC
 if(mode!="disabled")CloudCpuTiming::SetEnabled(true);
 if(mode=="ring"){
  const auto epoch=CloudHandoff::Epoch();std::atomic<bool> done{false};std::atomic<unsigned> observations{0};
  std::thread reader([&]{while(!done.load()){for(uint32_t i=0;i<CloudHandoff::Reserved();++i){const auto& e=CloudHandoff::Events()[i];if(e.ready.load(std::memory_order_acquire)){if(e.kind!=CloudHandoff::Enqueue||e.epoch!=epoch)std::terminate();++observations;}}}});
  std::vector<std::thread> workers;for(unsigned t=0;t<8;++t)workers.emplace_back([&]{for(unsigned i=0;i<10000;++i)CloudHandoff::Record(epoch,CloudHandoff::Enqueue,1,i);});
  for(auto& t:workers)t.join();
  done=true;reader.join();
  if(CloudHandoff::Reserved()!=CloudHandoff::Capacity||CloudHandoff::Dropped()!=80000-CloudHandoff::Capacity||clockCalls!=CloudHandoff::Capacity)return 10;
  for(uint32_t i=0;i<CloudHandoff::Capacity;++i)if(!CloudHandoff::Events()[i].ready.load())return 11;
  CloudCpuTiming::SetEnabled(false);CloudCpuTiming::SetEnabled(true);CloudHandoff::Record(CloudHandoff::Epoch(),CloudHandoff::WaitEnd,1,2);
  if(CloudHandoff::Reserved()!=CloudHandoff::Capacity||CloudHandoff::Dropped()!=80001-CloudHandoff::Capacity)return 12;
  std::cout<<"PASS bounded concurrent publication, saturation, explicit drops, no-reset toggles\n";return 0;
 }
#endif
 CMailBox mailbox;std::promise<void> gate;auto future=gate.get_future();
 std::atomic<bool> executing{false},senderStarted{false},returned{false};std::vector<unsigned> commands;
 mailbox.SendCall([&]{commands.push_back(11);executing=true;future.wait();commands.push_back(22);});
 std::thread receiver([&]{mailbox.ReceiveCall();mailbox.WaitForCall();mailbox.ReceiveCall();});
 until([&]{return executing.load();});
 std::thread sender([&]{senderStarted=true;mailbox.SendCall([&]{commands.push_back(33);},true);returned=true;});
 until([&]{return senderStarted.load();});
#ifdef CLOUD_HANDOFF_DIAGNOSTIC
 if(mode!="disabled")until([]{return has(CloudHandoff::WaitBegin);});
 if(mode=="toggle"){CloudCpuTiming::SetEnabled(false);CloudCpuTiming::SetEnabled(true);}
#endif
 if(returned.load())return 2;
 gate.set_value();sender.join();receiver.join();
 if(commands!=std::vector<unsigned>{11,22,33}||!returned.load())return 3;
#ifdef CLOUD_HANDOFF_DIAGNOSTIC
 if(mode=="disabled"&&(clockCalls||CloudHandoff::Reserved()||CloudHandoff::Dropped()))return 4;
 if(mode=="enabled"&&(!has(CloudHandoff::ExecuteEnd)||!has(CloudHandoff::WaitEnd)))return 5;
 const auto before=CloudHandoff::Reserved().load();CloudCpuTiming::SetEnabled(false);
 CloudHandoff::Record(CloudHandoff::Epoch(),CloudHandoff::Enqueue,0,0);
 if(CloudHandoff::Reserved()!=before)return 6;
#endif
 std::cout<<"PASS original command order [11,22,33], future/ACK synchronization; "<<mode<<"\n";
}
