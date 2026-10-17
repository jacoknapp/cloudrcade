#include "Js_DiscImageDeviceStream.h"
#include "CloudCpuTiming.h"
#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <emscripten.h>
#include <unistd.h>

uint64 CJsDiscImageDeviceStream::Size()
{
 if(!m_sized)
 {
  // JS validates safe integer sizes, so double preserves every DVD byte offset.
  m_size = static_cast<uint64>(MAIN_THREAD_EM_ASM_DOUBLE({return Module.discImageDevice.getFileSize()}));
  m_sized = true;
 }
 return m_size;
}
void CJsDiscImageDeviceStream::Seek(int64 position, Framework::STREAM_SEEK_DIRECTION whence)
{
 switch(whence)
 {
 case Framework::STREAM_SEEK_SET: m_position = position; break;
 case Framework::STREAM_SEEK_CUR: m_position += position; break;
 case Framework::STREAM_SEEK_END: m_position = Size() + position; break;
 default: throw std::runtime_error("Invalid PS2 disc seek.");
 }
}
uint64 CJsDiscImageDeviceStream::Tell() { return m_position; }
void CJsDiscImageDeviceStream::ReadAt(void* buffer, uint64 position, uint32 amount)
{
 CloudCpuTiming::Scope cloudTiming(CloudCpuTiming::DiscWait, true);
 MAIN_THREAD_EM_ASM({
  let position = ($1 >>> 0) + (($2 >>> 0) * 4294967296);
  Module.discImageDevice.read($0, position, $3);
 }, buffer, static_cast<uint32>(position), static_cast<uint32>(position >> 32), amount);
 while(!MAIN_THREAD_EM_ASM_INT({return Module.discImageDevice.isDone()})) usleep(100);
 int result = MAIN_THREAD_EM_ASM_INT({return Module.discImageDevice.result()});
 if(result < 0 || static_cast<uint32>(result) != amount) throw std::runtime_error("PS2 disc read failed.");
}
uint64 CJsDiscImageDeviceStream::Read(void* buffer, uint64 size)
{
 if(!size) return 0;
 uint64 total = 0, discSize = Size();
 while(total < size && m_position < discSize)
 {
  if(m_position < m_cacheStart || m_position - m_cacheStart >= m_cached)
  {
   m_cached = 0;
   // Keep already-coalesced ISO/CHD bulk reads direct instead of splitting them
   // into small browser requests or copying through the native sector buffer.
   if(size - total >= m_cache.size())
   {
    auto amount = static_cast<uint32>(std::min<uint64>(2 * 1024 * 1024, std::min(size - total, discSize - m_position)));
    ReadAt(static_cast<uint8*>(buffer) + total, m_position, amount);
    m_position += amount; total += amount;
    continue;
   }
   m_cacheStart = m_position / m_cache.size() * m_cache.size();
   uint32 amount = static_cast<uint32>(std::min<uint64>(m_cache.size(), discSize - m_cacheStart));
   ReadAt(m_cache.data(), m_cacheStart, amount);
   m_cached = amount;
  }
  auto from = static_cast<uint32>(m_position - m_cacheStart);
  auto count = static_cast<uint32>(std::min<uint64>(size - total, m_cached - from));
  std::memcpy(static_cast<uint8*>(buffer) + total, m_cache.data() + from, count);
  m_position += count; total += count;
 }
 return total;
}
uint64 CJsDiscImageDeviceStream::Write(const void*, uint64) { throw std::runtime_error("PS2 disc is read-only."); }
bool CJsDiscImageDeviceStream::IsEOF() { return m_position >= Size(); }
void CJsDiscImageDeviceStream::Flush() {}
