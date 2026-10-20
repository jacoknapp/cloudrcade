#include "WasmInstanceClock.h"
#include <cassert>
#include <set>
#include <vector>
struct Block { int id; };
int main() {
  WasmInstanceClock<Block> cache;
  Block a{1}, b{2}, c{3}, d{4};
  auto* hot = cache.Acquire(10, &a);
  assert(hot == cache.Acquire(10, &b));
  auto* cold = cache.Acquire(20, &c);
  cache.Acquire(30, &d);
  assert(cache.Size() == 3);
  std::set<int> invalidated;
  auto invalidate = [&](Block* block) { invalidated.insert(block->id); cache.Release(block); };
  assert(cache.Retire(100, 100, invalidate).empty()); // One pass only: second chances.
  assert(*hot == 0 && *cold == 0);
  *hot = 1;
  auto retired = cache.Retire(2, 1, invalidate);
  assert(retired == std::vector<int>{20});
  assert(invalidated == std::set<int>{3});
  assert(cache.Size() == 2 && *hot == 0); // Shared live pointer survives other retirement.
  *hot = 1;
  retired = cache.Retire(100, 100, invalidate);
  assert(retired == std::vector<int>{30});
  assert(invalidated == (std::set<int>{3,4}));
  retired = cache.Retire(100, 100, invalidate);
  assert(retired == std::vector<int>{10});
  assert(invalidated == (std::set<int>{1,2,3,4})); // All aliases invalidated before handle freed.
  assert(cache.Size() == 0);
  assert(cache.Retire(100, 100, invalidate).empty());
  // A native block allocation may be reused before its old function is retired.
  auto* old_ref = cache.Acquire(40, &a);
  cache.Release(&a);
  auto* new_ref = cache.Acquire(50, &a);
  assert(old_ref != new_ref);
  invalidated.clear();
  retired = cache.Retire(1, 1, invalidate);
  assert(retired == std::vector<int>{40} && invalidated.empty());
  assert(*new_ref == 1);
  assert(cache.Retire(100, 100, invalidate).empty());
  assert(cache.Retire(100, 100, invalidate) == std::vector<int>{50});
  assert(invalidated == std::set<int>{1});
  for (int i=0;i<1000;++i) {
    auto* ref=cache.Acquire(10,&a); assert(*ref == 1);
    cache.Release(&a); // Self-invalidation does not release executable code mid-call.
    assert(*ref == 1 && cache.Size() == 1);
    assert(cache.Retire(1,1,invalidate) == std::vector<int>{10});
  }
}
