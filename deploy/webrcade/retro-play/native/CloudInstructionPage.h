#pragma once

#include <array>
#include <cstdint>
#include <cstring>

// Exact host-only copy used as the unchanged-page filter. Not serialized.
class CloudInstructionPage
{
public:
 static constexpr unsigned SIZE = 0x1000;
 void Assign(const void* source) { std::memcpy(m_bytes.data(), source, SIZE); }
 bool Equals(const void* source) const noexcept;

private:
 std::array<uint8_t, SIZE> m_bytes;
};

static_assert(sizeof(CloudInstructionPage) == CloudInstructionPage::SIZE);
