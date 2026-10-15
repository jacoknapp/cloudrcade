#pragma once
#include "Stream.h"
#include <array>

// Coalesce sector-sized native reads before crossing to the browser. The
// network cache stays in JS; each open disc stream owns just 64KiB here.
class CJsDiscImageDeviceStream : public Framework::CStream
{
public:
 virtual ~CJsDiscImageDeviceStream() = default;
 void Seek(int64, Framework::STREAM_SEEK_DIRECTION) override;
 uint64 Tell() override;
 uint64 Read(void*, uint64) override;
 uint64 Write(const void*, uint64) override;
 bool IsEOF() override;
 void Flush() override;
private:
 uint64 Size();
 void ReadAt(void*, uint64, uint32);
 uint64 m_position = 0, m_size = 0, m_cacheStart = 0;
 bool m_sized = false;
 uint32 m_cached = 0;
 std::array<uint8, 64 * 1024> m_cache;
};
