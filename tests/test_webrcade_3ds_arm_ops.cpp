// Compare compact ARM operations with a scalar reference and observable memory callbacks.
#include "core/arm/dyncom/arm_dyncom_dec.h"
#include "core/arm/dyncom/arm_dyncom_trans.h"
#include "core/arm/dyncom/wasm_arm_ops.h"
#include <array>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>
#include <random>

namespace {
struct Access {
    unsigned size{}, address{}, value{};
    bool write{};
    bool operator==(const Access&) const = default;
};

struct Cpu {
    std::array<std::uint32_t, 16> Reg{};
    unsigned NFlag{}, ZFlag{}, CFlag{}, VFlag{}, shifter_carry_out{};
    Access access;
    static unsigned MemoryValue(unsigned address) { return address ^ 0xe516c27bu; }
    unsigned ReadMemory32(unsigned address) {
        access = {4, address, MemoryValue(address), false};
        return access.value;
    }
    unsigned ReadMemory8(unsigned address) {
        access = {1, address, MemoryValue(address) & 255u, false};
        return access.value;
    }
    void WriteMemory32(unsigned address, unsigned value) { access = {4, address, value, true}; }
    void WriteMemory8(unsigned address, std::uint8_t value) { access = {1, address, value, true}; }
    bool operator==(const Cpu&) const = default;
};

void Compare(unsigned word, Cpu before) {
    WasmArm::Instruction inst;
    assert(WasmArm::Decode(word, inst));
    const bool register_only = !(word & (1u << 26));
    assert(WasmArm::IsRegisterOperation(inst.operation) == register_only);
    Cpu actual = before;
    WasmArm::Execute(actual, inst);
    const unsigned rd = (word >> 12) & 15, rn = (word >> 16) & 15;
    const unsigned lhs = before.Reg[rn];
    if (word & (1u << 26)) {
        const unsigned delta = word & 4095u;
        const unsigned address = word & (1u << 23) ? lhs + delta : lhs - delta;
        const unsigned width = word & (1u << 22) ? 1 : 4;
        const unsigned mask = width == 1 ? 255u : ~0u;
        const bool store = !(word & (1u << 20));
        const unsigned value = (store ? before.Reg[rd] : Cpu::MemoryValue(address)) & mask;
        before.access = {width, address, value, store};
        if (!store) before.Reg[rd] = value;
    } else {
        unsigned rhs = before.Reg[word & 15];
        before.shifter_carry_out = before.CFlag;
        if (word & (1u << 25)) {
            const unsigned shift = ((word >> 8) & 15) * 2;
            const std::uint64_t byte = word & 255u;
            rhs = static_cast<unsigned>(((byte << 32) | byte) >> shift);
            if (shift) before.shifter_carry_out = rhs >> 31;
        }
        switch ((word >> 21) & 15) {
        case 4: before.Reg[rd] = lhs + rhs; break;
        case 2: before.Reg[rd] = lhs - rhs; break;
        case 13: before.Reg[rd] = rhs; break;
        case 10: {
            const auto wide = std::int64_t(std::int32_t(lhs)) - std::int64_t(std::int32_t(rhs));
            before.NFlag = (lhs - rhs) >> 31;
            before.ZFlag = lhs == rhs;
            before.CFlag = std::uint64_t(lhs) + (0xffffffffu - rhs) + 1 > 0xffffffffu;
            before.VFlag = wide < INT32_MIN || wide > INT32_MAX;
            break;
        }
        default: assert(false);
        }
    }
    assert(actual == before);
}
}

int main() {
    // An empty payload still occupies one byte. The next instruction may
    // carry an addressing function pointer, including on wider host builds.
    static_assert(alignof(arm_inst) >= alignof(ldst_inst));
    static_assert(offsetof(arm_inst, component) % alignof(ldst_inst) == 0);
    for (auto payload : {sizeof(clrex_inst), sizeof(ldc_inst), sizeof(stc_inst),
                         sizeof(pld_inst), sizeof(WasmArm::Instruction), sizeof(ldst_inst)}) {
        const auto size = sizeof(arm_inst) + payload;
        const auto stride = DyncomRecordSize(size);
        assert(stride >= size && stride - size < alignof(arm_inst));
        assert(stride % alignof(arm_inst) == 0);
    }

    // Decode both branch forms under every normal ARM predicate. Encoding
    // condition 15 in this space selects a different instruction (BLX).
    for (unsigned condition = 0; condition < 15; ++condition) {
        for (unsigned form : {0x0a000000u, 0x0b000000u}) {
            for (unsigned offset : {0u, 0x7fffffu, 0x800000u, 0xffffffu}) {
                int index = -1;
                const auto word = condition << 28 | form | offset;
                assert(DecodeARMInstruction(word, &index) == ARMDecodeStatus::SUCCESS);
                assert(static_cast<unsigned>(index) == WasmArm::BranchIndex);
            }
        }
    }
    int blx = -1;
    assert(DecodeARMInstruction(0xfa000000, &blx) == ARMDecodeStatus::SUCCESS);
    assert(static_cast<unsigned>(blx) != WasmArm::BranchIndex);

    Cpu cpu;
    std::mt19937 rng(0x3d5);
    for (int i = 0; i < 8192; ++i) {
        for (auto& r : cpu.Reg) r = rng();
        cpu.CFlag = rng() & 1;
        cpu.NFlag = cpu.VFlag = cpu.ZFlag = cpu.shifter_carry_out = i & 1;
        const unsigned rn = rng() % 15, rd = rng() % 15;
        for (unsigned opcode : {4u, 8u, 21u, 26u}) {
            const unsigned stem = 0xe0000000u | (opcode << 20) |
                ((opcode == 26 ? 0 : rn) << 16) | ((opcode == 21 ? 0 : rd) << 12);
            Compare(stem | (1u << 25) | (i & 4095u), cpu);
            Compare(stem | (rng() % 15), cpu);
        }
        for (unsigned mode = 0; mode < 8; ++mode) {
            const unsigned word = 0xe5000000u | ((mode & 4) << 21) | ((mode & 2) << 21) |
                ((mode & 1) << 20) | (rn << 16) | (rd << 12) | (i & 4095u);
            Compare(word, cpu);
        }
    }
    for (unsigned left : {0u, 1u, 0x7fffffffu, 0x80000000u, ~0u}) {
        for (unsigned right : {0u, 1u, 0x7fffffffu, 0x80000000u, ~0u}) {
            cpu.Reg[1] = left; cpu.Reg[2] = right;
            Compare(0xe1510002, cpu);
        }
    }
    WasmArm::Instruction out;
    for (unsigned word : {
        0x12810002u, 0xe2910002u, 0xe281f002u, 0xe28f0002u, 0xe081000fu,
        0xe0810082u, 0xe7910002u, 0xe5b10002u, 0xe4910002u, 0xe59f0002u,
        0xe591f002u, 0xe8900003u, 0xea000000u, 0xef000000u, 0xe0000291u}) {
        assert(!WasmArm::Decode(word, out));
    }
    std::cout << "PASS compact ARM arithmetic, flags, memory callbacks and generic fallbacks\n";
}
