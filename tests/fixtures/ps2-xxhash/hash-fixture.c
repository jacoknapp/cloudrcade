#include "xxhash.h"
#include <string.h>

void hash(const void *input, unsigned length, void *output) {
 const XXH128_hash_t value = XXH3_128bits(input, length);
 memcpy(output, &value, sizeof(value));
}

void hash_pages(const unsigned char *input, unsigned count, unsigned loops, void *output) {
 XXH128_hash_t sum = {0, 0};
 for(unsigned loop = 0; loop < loops; ++loop)
  for(unsigned page = 0; page < count; ++page) {
   const XXH128_hash_t value = XXH3_128bits(input + 4096 * page, 4096);
   sum.low64 += value.low64;
   sum.high64 ^= value.high64 + loop + page;
  }
 memcpy(output, &sum, sizeof(sum));
}
