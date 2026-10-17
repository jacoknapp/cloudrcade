#include "../deploy/webrcade/retro-play/native/TailChain.h"
#include <cassert>
#include <iostream>
int main() {
 CloudTail::State state;
 state.Add(0x1000,7);assert(state.entries[1024].function==7);
 state.Add(0x5000,9);state.Remove(0x1000);
 assert(state.entries[1024].pc==0x5000 && state.entries[1024].function==9);
 state.Remove(0x5000);assert(state.entries[1024].function==0);
 state.Add(0x5000,11);state.Clear();assert(state.entries[1024].function==0 && state.budget==0);
 const uint8_t invalid[]={0,97,115,109,1,0,0,0,2,127};bool threw=false;
 try{CloudTail::Rewrite(invalid,sizeof(invalid),{});}catch(const std::runtime_error&){threw=true;}assert(threw);
 std::cout<<"PASS active target collision/removal/reset and malformed generated-module rejection\n";
}
