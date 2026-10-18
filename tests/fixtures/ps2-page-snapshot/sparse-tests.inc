#ifdef PROTOTYPE_SPARSE
static_assert(sizeof(CloudInstructionPage)==4096);
static_assert(noexcept(std::declval<const CloudInstructionPage&>().EqualsCovered(nullptr,0)));
static uint64_t IndependentCoverage(uint64_t prior,uint32 page,uint32 start,uint32 end) {
 if(prior==UINT64_MAX)return prior;
 bool touched=false;
 // Independent byte membership oracle: no range-mask shifts or ctz.
 bool selected[64]{};for(unsigned i=0;i<64;++i)selected[i]=(prior&(uint64_t(1)<<i))!=0;
 for(unsigned i=0;i<4096;++i) {
  const uint64_t address=uint64_t(page)+i;
  if(start<=end && address>=start && address<uint64_t(end)+4) {selected[i/64]=true;touched=true;}
 }
 if(!touched)return prior;
 unsigned count=0;uint64_t wanted=0;
 for(unsigned i=0;i<64;++i)if(selected[i]){++count;wanted|=uint64_t(1)<<i;}
 return count>16?UINT64_MAX:wanted;
}
static bool IndependentEquals(const uint8_t* a,const uint8_t* b,uint64_t mask) {
 for(unsigned i=0;i<4096;++i)if((mask&(uint64_t(1)<<(i/64))) && a[i]!=b[i])return false;
 return true;
}
extern "C" unsigned run_sparse_checks() {
 unsigned coverageCases=0,compareCases=0;
 const uint32 pages[]={0,1,4096,0x7ffff000U,0xffffe000U,0xfffff000U,0xfffffff0U};
 const uint32 boundaries[]={0,1,3,4,60,63,64,65,1019,1020,1023,1024,1025,2047,2048,4031,4032,4091,4092,4095,4096,4097,8191,0x7fffffffU,0xffffefffU,0xfffff000U,0xfffffffcU,0xffffffffU};
 const uint64_t priors[]={0,1,UINT64_C(1)<<63,UINT64_C(0xffff),UINT64_C(0x1111111111111111),UINT64_MAX};
 for(auto page:pages)for(auto a:boundaries)for(auto b:boundaries)for(auto prior:priors) {
  const uint32 start=page+a,end=page+b;
  const auto expected=IndependentCoverage(prior,page,start,end);
  const auto actual=CloudInstructionPage::AddCoverage(prior,page,start,end);
  assert(actual==expected);assert((actual&prior)==prior);++coverageCases;
 }
 uint32 random=0x976ab341U;
 auto next=[&](){random^=random<<13;random^=random>>17;random^=random<<5;return random;};
 for(unsigned i=0;i<10000;++i) {
  const uint32 page=next()&~4095U;const uint32 start=page+(next()%8192)-2048;const uint32 end=start+(next()%8192);
  const auto prior=priors[next()%6];
  assert(CloudInstructionPage::AddCoverage(prior,page,start,end)==IndependentCoverage(prior,page,start,end));++coverageCases;
 }
 alignas(16) uint8_t reference[4096];uint8_t guarded[4096+128];CloudInstructionPage page;
 for(unsigned i=0;i<4096;++i)reference[i]=uint8_t(i*37+(i>>5));
 page.Assign(reference);
 for(unsigned alignment:{0U,1U,15U,31U,63U}) {
  memset(guarded,0xa7,sizeof(guarded));auto* actual=guarded+alignment;memcpy(actual,reference,4096);
  assert(page.EqualsCovered(actual,0));assert(page.EqualsCovered(actual,UINT64_MAX));
  for(unsigned i=0;i<4096;++i) {
   const uint64_t own=uint64_t(1)<<(i/64),other=uint64_t(1)<<((i/64+1)%64);
   for(unsigned bit=0;bit<8;++bit) {
    actual[i]^=uint8_t(1)<<bit;
    assert(!page.EqualsCovered(actual,own));++compareCases;
    assert(page.EqualsCovered(actual,other));++compareCases;
    assert(!page.EqualsCovered(actual,UINT64_MAX));++compareCases;
    actual[i]^=uint8_t(1)<<bit;
   }
  }
  for(unsigned i=0;i<3000;++i) {
   uint64_t mask=(uint64_t(next())<<32)|next();if(i%17==0)mask=0;if(i%19==0)mask=UINT64_MAX;
   const unsigned at=next()%4096;actual[at]^=uint8_t(next()|1);
   assert(page.EqualsCovered(actual,mask)==IndependentEquals(actual,reference,mask));++compareCases;
  }
  for(unsigned i=0;i<alignment;++i)assert(guarded[i]==0xa7);
  for(unsigned i=alignment+4096;i<sizeof(guarded);++i)assert(guarded[i]==0xa7);
  assert(page.Equals(reference));
 }
 assert(page.EqualsCovered(nullptr,0));++compareCases;
 // Dense saturation remains conservative after partial removal, then disappears
 // with the page. Existing bytes must not be refreshed on new registration.
 CEeExecutor e;std::map<uint32,std::vector<uint8>> ref;
 for(unsigned chunk=0;chunk<17;++chunk)Compile(e,ref,chunk*64,chunk*64);
 assert(e.m_instructionPages.at(0).coverage==UINT64_MAX);
 e.ClearActiveBlocksInRange(0,16*64,false);
 for(auto it=ref.begin();it!=ref.end();)if(!e.HasBlockAt(it->first))it=ref.erase(it);else++it;
 assert(e.m_instructionPages.at(0).coverage==UINT64_MAX);FlushAgainstReference(e,ref);
 e.ClearActiveBlocksInRange(16*64,17*64,false);ref.clear();assert(e.m_instructionPages.empty());
 Compile(e,ref,128,128);assert(e.m_instructionPages.at(0).coverage==4);
 e.memory[2048]^=4;FlushAgainstReference(e,ref);assert(e.HasBlockAt(128));
 // Previously ignored data becomes a newly covered instruction; compare against
 // its original full-page snapshot, but do not invalidate its new compiled hash.
 Compile(e,ref,2048,2052);FlushAgainstReference(e,ref);assert(e.HasBlockAt(128)&&e.HasBlockAt(2048));
 e.memory[128]^=8;e.memory[3008]^=2;Compile(e,ref,3008,3012);
 FlushAgainstReference(e,ref);assert(!e.HasBlockAt(128)&&e.HasBlockAt(2048)&&e.HasBlockAt(3008));
 // Fresh and stale sparse masks, overlap, chunk endpoints, and cross-page ends.
 e.Reset();ref.clear();
 Compile(e,ref,60,64);Compile(e,ref,128,132);
 e.ClearActiveBlocksInRange(60,68,false);ref.erase(60);
 assert(e.m_instructionPages.at(0).coverage==7);FlushAgainstReference(e,ref);
 Compile(e,ref,4092,4096);e.memory[4099]^=32;FlushAgainstReference(e,ref);
 assert(!e.HasBlockAt(4092));
 printf("PASS %u independent byte-coverage cases, %u comparison cases, sparse lifecycle\n",coverageCases,compareCases);
 return coverageCases+compareCases;
}
extern "C" bool equals_covered_snapshot(const void* source,uint32 low,uint32 high){return saved.EqualsCovered(source,uint64_t(low)|(uint64_t(high)<<32));}
#else
extern "C" unsigned run_sparse_checks(){return 0;}
extern "C" bool equals_covered_snapshot(const void* source,uint32,uint32){return saved.Equals(source);}
#endif
