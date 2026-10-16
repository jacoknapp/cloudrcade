#include "ChunkedRollbackBuffer.h"
#include <cassert>
#include <cstdint>
#include <vector>

// Deterministic codec exercises chunk ownership, budgets and failures. The
// actual native LZ4 integration is exercised by the real-core browser tests.
struct Codec
{
  static inline int calls = 0;
  static inline int fail_compress = 0;
  static inline bool fail_decode = false;
  static int Bound(int n) { return 2 * n; }
  static int Compress(const char* src, char* dst, int n, int capacity)
  {
    assert(n <= 64);
    if (++calls == fail_compress)
      return 0;
    int written = 0;
    for (int i = 0; i < n;)
    {
      int count = 1;
      while (i + count < n && src[i + count] == src[i] && count < 255)
        ++count;
      assert(written + 2 <= capacity);
      dst[written++] = src[i];
      dst[written++] = static_cast<char>(count);
      i += count;
    }
    return written;
  }
  static int Decompress(const char* src, char* dst, int n, int capacity)
  {
    if (fail_decode)
      return -1;
    int written = 0;
    for (int i = 0; i < n; i += 2)
    {
      const int count = static_cast<unsigned char>(src[i + 1]);
      assert(written + count <= capacity);
      for (int j = 0; j < count; ++j)
        dst[written++] = src[i];
    }
    return written;
  }
};

int main()
{
  State::ChunkedRollbackBuffer<Codec, 64> rollback;
  assert(!rollback.TryStore({}));
  assert(rollback.Empty());
  for (std::size_t size : {63u, 64u, 65u, 1025u})
  {
    std::vector<unsigned char> input(size, 42), output(size);
    assert(rollback.TryStore(input));
    input.assign(size, 99);  // The encoded snapshot owns its bytes.
    assert(rollback.RawSize() == size);
    assert(rollback.Restore(output));
    assert(output == std::vector<unsigned char>(size, 42));
    std::vector<unsigned char> wrong(size + 1, 7);
    assert(!rollback.Restore(wrong));
    assert(wrong == std::vector<unsigned char>(size + 1, 7));
    Codec::fail_decode = true;
    assert(!rollback.Restore(output));
    Codec::fail_decode = false;
    assert(rollback.Restore(output));
    rollback.Clear();
    assert(rollback.Empty());
    assert(!rollback.Restore(output));
  }
  std::vector<unsigned char> input(256, 0);
  assert(rollback.TryStore(input));
  // Poor compression, including a failure after a useful first chunk, must
  // drop every partial encoded block and leave the caller's raw data intact.
  for (std::size_t i = 64; i < input.size(); ++i)
    input[i] = static_cast<unsigned char>(i);
  const auto original = input;
  assert(!rollback.TryStore(input));
  assert(input == original);
  assert(rollback.Empty());
  input.assign(256, 0);
  Codec::calls = 0;
  Codec::fail_compress = 3;
  assert(!rollback.TryStore(input));
  assert(rollback.Empty());
  Codec::fail_compress = 0;
  assert(rollback.TryStore(input));
  std::vector<unsigned char> output(256, 1);
  assert(rollback.Restore(output));
  assert(output == input);
}
