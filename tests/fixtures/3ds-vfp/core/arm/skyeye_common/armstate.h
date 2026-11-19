// Register storage for the native VFP differential. The real CPU constructor
// also needs a running system, memory and debugger, which VFP never accesses.
#pragma once

#include <array>
#include "common/common_types.h"
#include "core/arm/skyeye_common/arm_regformat.h"

struct ARMul_State {
    std::array<u32, 16> Reg{};
    std::array<u32, VFP_SYSTEM_REGISTER_COUNT> VFP{};
    std::array<u32, 64> ExtReg{};
    bool operator==(const ARMul_State&) const = default;
};
