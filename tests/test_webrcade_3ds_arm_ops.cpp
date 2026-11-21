// Compare compact ARM operations with a scalar reference and observable memory callbacks.
#include "core/arm/dyncom/arm_dyncom_dec.h"
#include "core/arm/dyncom/arm_dyncom_trans.h"
#include "core/arm/dyncom/wasm_arm_ops.h"
#include "core/arm/dyncom/wasm_arm_stack.h"
#include "core/arm/dyncom/wasm_arm_vfp.h"
#include <algorithm>
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
    std::array<std::uint32_t, 64> ExtReg{};
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
        case 0: before.Reg[rd] = lhs & rhs; break;
        case 1: before.Reg[rd] = lhs ^ rhs; break;
        case 12: before.Reg[rd] = lhs | rhs; break;
        case 14: before.Reg[rd] = lhs & ~rhs; break;
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

void CheckMappedRuns() {
    constexpr std::array words{
        0xe5801001u, // STR r1, [r0, #1]
        0xe5902001u, // LDR r2, [r0, #1]
        0xe2823001u, // ADD r3, r2, #1
        0xe5c03004u, // STRB r3, [r0, #4]
        0xe5d04004u, // LDRB r4, [r0, #4]
        0xe5851000u, // STR r1, [r5] (cross-page or special)
        0xe3a06001u, // MOV r6, #1
    };
    std::array<WasmArm::Instruction, words.size()> run{};
    for (unsigned i = 0; i < words.size(); ++i)
        assert(WasmArm::Decode(words[i], run[i]));

    for (unsigned miss_address : {4093u, 4094u, 4095u, 4096u}) {
        for (unsigned budget = 0; budget <= words.size(); ++budget) {
            Cpu expected{};
            expected.Reg[1] = 0x12345678;
            expected.Reg[5] = miss_address;
            expected.Reg[15] = 0x18000;
            Cpu actual = expected;
            // Padding makes an accidental cross-page write observable even without sanitizers.
            std::array<std::uint8_t, 4096 + 3> ram{}, expected_ram{};
            std::array<std::uint8_t*, 2> pages{ram.data(), nullptr};
            const auto retired = WasmArm::RunMapped(actual, pages.data(), budget,
                [&](unsigned i) -> const WasmArm::Instruction& { return run.at(i); });

            if (budget >= 1) {
                expected_ram[1] = 0x78; expected_ram[2] = 0x56;
                expected_ram[3] = 0x34; expected_ram[4] = 0x12;
            }
            if (budget >= 2) expected.Reg[2] = 0x12345678;
            if (budget >= 3) expected.Reg[3] = 0x12345679;
            if (budget >= 4) expected_ram[4] = 0x79;
            if (budget >= 5) expected.Reg[4] = 0x79;
            assert(retired == std::min(budget, 5u));
            assert(actual == expected && ram == expected_ram);
        }
    }

    Cpu cpu{};
    std::array<std::uint8_t, 4096> ram{};
    std::array<std::uint8_t*, 2> pages{ram.data(), nullptr};
    cpu.Reg[1] = 4092;
    cpu.Reg[2] = 0x89abcdef;
    WasmArm::Instruction store{}, load{}, byte_load{};
    assert(WasmArm::Decode(0xe5812000u, store));
    assert(WasmArm::Decode(0xe5913000u, load));
    assert(WasmArm::Decode(0xe5d13000u, byte_load));
    assert(WasmArm::ExecuteMapped(cpu, store, pages.data()));
    assert(WasmArm::ExecuteMapped(cpu, load, pages.data()) && cpu.Reg[3] == 0x89abcdef);
    cpu.Reg[1] = 4095;
    assert(WasmArm::ExecuteMapped(cpu, byte_load, pages.data()) && cpu.Reg[3] == 0x89);
    for (unsigned miss_address : {4093u, 4094u, 4095u, 4096u}) {
        cpu.Reg[1] = miss_address;
        const auto before = cpu;
        const auto before_ram = ram;
        assert(!WasmArm::ExecuteMapped(cpu, load, pages.data()));
        assert(cpu == before && ram == before_ram);
    }
}

void CheckMixedVfpRuns() {
    using namespace WasmArm;

    constexpr std::array words{0xe2801004u, 0xed9f0a00u, 0xee300a00u, 0xed810a00u};
    std::array<Instruction, words.size()> run{};
    assert(Decode(words[0], run[0]));
    for (unsigned i = 1; i < words.size(); ++i) {
        assert(DecodeVfp(words[i], run[i]));
        assert(!DecodeVfp(words[i] ^ (1u << 8), run[i]));
        assert(!DecodeVfp(words[i] ^ (1u << 28), run[i]));
    }
    const auto instruction_at = [&](unsigned i) -> const Instruction& { return run.at(i); };
    const auto add_four = [](Cpu& cpu, std::uint32_t word) {
        assert(word == 0xee300a00u);
        cpu.ExtReg[0] += 4;
    };

    for (unsigned budget = 0; budget <= words.size(); ++budget) {
        Cpu cpu;
        cpu.Reg[0] = 8;
        cpu.Reg[15] = 0x20;
        std::array<std::uint8_t, 4096> page{};
        page[0x2c] = 0x23;
        std::array<std::uint8_t*, 2> pages{page.data(), nullptr};

        assert(RunMappedWithVfp(cpu, pages.data(), budget, instruction_at, add_four) == budget);
        assert(cpu.Reg[1] == (budget >= 1 ? 12u : 0u));
        assert(cpu.Reg[15] == 0x20);
        assert(cpu.ExtReg[0] == (budget >= 3 ? 0x27u : budget >= 2 ? 0x23u : 0u));
        assert(page[12] == (budget >= 4 ? 0x27u : 0u));
        assert(cpu.access == Access{});
    }

    std::array<std::uint8_t, 4096> page{};
    std::array<std::uint8_t*, 2> pages{page.data(), nullptr};
    for (unsigned miss : {4093u, 4094u, 4095u, 4096u}) {
        Cpu cpu;
        cpu.Reg[0] = 8;
        cpu.Reg[15] = miss - 12; // The second instruction is VLDR s0, [PC, #0].
        if (miss & 3u) {
            assert(DecodeVfp(0xed901a00, run[1]));
            cpu.Reg[0] = miss;
        }
        assert(RunMappedWithVfp(cpu, pages.data(), 2, instruction_at, add_four) == 1);
        assert(cpu.ExtReg[0] == 0 && cpu.ExtReg[2] == 0 && cpu.access == Access{});
        cpu.Reg[15] += 4;
        ExecuteVfp(cpu, run[1], add_four);
        assert(cpu.access == (Access{4, miss, Cpu::MemoryValue(miss), false}));
        assert(DecodeVfp(words[1], run[1]));
    }

    Instruction rejected;
    assert(!DecodeVfp(0xed200a00, rejected)); // Multiple transfer with writeback.
    assert(!DecodeVfp(0xee800a00, rejected)); // Divide retains its existing decoder.
}

void CheckMappedStackTransfers() {
    struct StackCpu {
        std::array<std::uint32_t, 16> Reg{};
        bool TFlag{}, big{};
        bool InBigEndianMode() const { return big; }
        bool operator==(const StackCpu&) const = default;
    } cpu;
    std::array<std::uint8_t, 4096 + 12> ram{};
    std::array<std::uint8_t*, 2> pages{ram.data(), nullptr};
    constexpr unsigned push = 0xe92d4030, pop = 0xe8bd8030; // r4/r5 and LR (push) or PC (pop).
    WasmArm::Instruction out{};
    // These take their own normal dispatch/budget check, including after a compact run.
    assert(!WasmArm::Decode(push, out) && !WasmArm::Decode(pop, out));
    for (auto ret : {0x76543210u, 0x76543213u}) {
        cpu = {};
        cpu.Reg[4] = 0x44332211; cpu.Reg[5] = 0x88776655;
        cpu.Reg[13] = 4096; cpu.Reg[14] = ret; cpu.Reg[15] = 0x1000;
        assert(WasmArmStack::TryTransfer<false>(cpu, push, false, pages.data()));
        assert(cpu.Reg[13] == 4084 && cpu.Reg[15] == 0x1000);
        const std::array<std::uint8_t, 12> saved{
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
            static_cast<std::uint8_t>(ret), 0x32, 0x54, 0x76
        };
        assert(std::equal(saved.begin(), saved.end(), ram.begin() + 4084));
        cpu.Reg[4] = cpu.Reg[5] = 0;
        assert(WasmArmStack::TryTransfer<true>(cpu, pop, false, pages.data()));
        assert(cpu.Reg[4] == 0x44332211 && cpu.Reg[5] == 0x88776655 && cpu.Reg[13] == 4096);
        assert(cpu.Reg[15] == (ret & ~1u) && cpu.TFlag == (ret & 1u));
    }

    // At 4096, POP starts on a special page. Adjacent starts exercise a crossing
    // transfer, a misaligned SP, and a 32-bit writeback wrap in each direction.
    for (bool restore : {false, true}) {
        for (unsigned sp : {restore ? 4092u : 4100u, restore ? 4096u : 4108u,
                            4085u, restore ? 0xfffffffcu : 4u}) {
            cpu.TFlag = false; cpu.Reg[13] = sp;
            const auto before = cpu;
            const auto bytes = ram;
            const auto ok = restore ? WasmArmStack::TryTransfer<true>(cpu, pop, false, pages.data())
                                    : WasmArmStack::TryTransfer<false>(cpu, push, false, pages.data());
            assert(!ok && cpu == before && ram == bytes);
        }
    }
}
}

int main() {
    CheckMappedRuns();
    CheckMixedVfpRuns();
    CheckMappedStackTransfers();
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
        for (unsigned opcode : {0u, 2u, 4u, 8u, 21u, 24u, 26u, 28u}) {
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
    std::cout << "PASS compact ARM arithmetic, flags, mapped runs, memory callbacks and generic fallbacks\n";
}
