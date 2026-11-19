// Synthetic A32 programs exercise register aliases, flags, mapping and slice boundaries.
#include "core/arm/dyncom/wasm_arm_loop.h"
#include <array>
#include <cassert>
#include <iostream>
#include <random>

namespace {
using namespace WasmArmLoop;
struct Cpu {
    std::array<Word, 16> Reg{};
    Word NFlag{}, ZFlag{}, CFlag{}, VFlag{}, shifter_carry_out{}, Cpsr{}, NirqSig{1};
    bool operator==(const Cpu&) const = default;
};

void Arithmetic() {
    std::mt19937 random(0x32ba);
    std::array<Byte*, 1> pages{};
    for (unsigned i = 0; i < 65536; ++i) {
        Cpu initial;
        for (auto& r : initial.Reg) r = random();
        initial.CFlag = i & 1;
        initial.NFlag = i >> 1 & 1;
        initial.ZFlag = i >> 2 & 1;
        initial.VFlag = i >> 3 & 1;
        const unsigned rn = random() % 15, rd = random() % 15, rm = random() % 15;
        const unsigned shift = random() % 32, rotate = random() % 16;
        const Word literal = random() & 255;
        for (unsigned opcode : {0u, 2u, 4u, 5u, 8u}) {
            for (unsigned form = 0; form < 3; ++form) {
                if (form == 2 && !shift) continue;
                Word word = 0xe0000000 | (opcode << 20) | (rn << 16) | (rd << 12);
                Cpu expected = initial;
                const Word lhs = initial.Reg[rn], input = initial.Reg[rm];
                Word rhs;
                expected.shifter_carry_out = initial.CFlag;
                if (form == 0) {
                    word |= (1 << 25) | (rotate << 8) | literal;
                    rhs = static_cast<Word>(((std::uint64_t(literal) << 32) | literal) >> (2 * rotate));
                    if (rotate) expected.shifter_carry_out = rhs >> 31;
                } else if (form == 1) {
                    word |= (shift << 7) | rm;
                    const std::uint64_t wide = std::uint64_t(input) << shift;
                    rhs = static_cast<Word>(wide);
                    if (shift) expected.shifter_carry_out = (wide >> 32) & 1;
                } else {
                    word |= 32 | (shift << 7) | rm;
                    rhs = input >> shift;
                    expected.shifter_carry_out = (input >> (shift - 1)) & 1;
                }
                switch (opcode) {
                case 0: expected.Reg[rd] = lhs & rhs; break;
                case 2: expected.Reg[rd] = lhs ^ rhs; break;
                case 8: expected.Reg[rd] = lhs + rhs; break;
                default: expected.Reg[rd] = lhs - rhs; break;
                }
                if (opcode == 5) {
                    const auto diff = std::int64_t(std::int32_t(lhs)) - std::int32_t(rhs);
                    expected.NFlag = expected.Reg[rd] >> 31;
                    expected.ZFlag = lhs == rhs;
                    expected.CFlag = std::uint64_t(lhs) + (0xffffffffu - rhs) + 1 > UINT32_MAX;
                    expected.VFlag = diff > INT32_MAX || diff < INT32_MIN;
                }
                Cpu actual = initial;
                Op op;
                assert(Decode(word, op) && Execute(actual, op, pages.data()));
                assert(actual == expected);
            }
        }
    }
}

void Loads() {
    std::array<Byte, 4096> memory;
    for (unsigned i = 0; i < memory.size(); ++i) memory[i] = static_cast<Byte>(i * 73);
    std::array<Byte*, 3> pages{nullptr, memory.data(), nullptr};
    for (unsigned width : {1u, 2u, 4u}) {
        for (unsigned mode = 0; mode < 16; ++mode) {
            const bool pre = mode & 1, up = mode & 2, w = mode & 4, alias = mode & 8;
            const unsigned rd = alias ? 2 : 3;
            Word word = 0xe0100000 | 2 << 16 | rd << 12 | unsigned(pre) << 24 |
                        unsigned(up) << 23 | unsigned(w) << 21;
            if (width == 2) word |= 0x004000b0 | 0x304;
            else word |= 0x04000000 | (width == 1 ? 1u << 22 : 0) | 0x34;
            Op op;
            assert(Decode(word, op) == !((!pre && w) || (alias && (!pre || w))));
            if ((!pre && w) || (alias && (!pre || w))) continue;
            for (Word address : {0x1080u, 0x1ffdu, 0x1ffeu, 0x1fffu, 0x2000u}) {
                Cpu cpu;
                const Word delta = up ? 0x34 : -0x34u;
                cpu.Reg[2] = pre ? address - delta : address;
                Cpu expected = cpu;
                bool ok = address + width <= 0x2000;
                if (ok) {
                    Word value = 0;
                    for (unsigned b = 0; b < width; ++b)
                        value |= Word(memory[(address & 4095) + b]) << (8 * b);
                    if (!pre || w) expected.Reg[2] += delta;
                    expected.Reg[rd] = value;
                }
                assert(Execute(cpu, op, pages.data()) == ok);
                assert(cpu == expected);
            }
        }
    }
}

void Control() {
    // Sum successive bytes into r7, counting down in r9. Each register,
    // addressing mode and condition is independently represented by this fixture.
    const std::array<Word, 4> words{0xe4d81001, 0xe0877001, 0xe2599001, 0x1afffffb};
    Block block{};
    assert(Build(words, 713, block) && block.original_offset == 713);
    std::array<Byte, 4096> memory{};
    memory[0] = 3; memory[1] = 5; memory[2] = 7;
    std::array<Byte*, 2> pages{memory.data(), nullptr};
    auto branch = [](Cpu& cpu, unsigned cond) { assert(cond == 1); return !cpu.ZFlag; };
    for (unsigned budget = 0; budget <= 15; ++budget) {
        Cpu cpu;
        cpu.Reg[9] = 3;
        cpu.Reg[15] = 100;
        unsigned loops = std::min(3u, budget / 4);
        Result res = Run(cpu, block, pages.data(), budget, branch);
        assert(res.executed == 4 * loops && cpu.Reg[8] == loops && cpu.Reg[9] == 3 - loops);
        assert(cpu.Reg[15] == (loops == 3 ? 116u : 100u));
        constexpr std::array<Word, 4> sums{0, 3, 8, 15};
        assert(cpu.Reg[7] == sums[loops]);
        assert(res.original == (loops < 3 && (budget % 4) != 0));
    }
    Cpu irq;
    irq.Reg[9] = 3; irq.NirqSig = 0;
    assert(Run(irq, block, pages.data(), 40, branch).executed == 4 && irq.Reg[9] == 2);
    irq.Cpsr |= 0x80;
    assert(Run(irq, block, pages.data(), 40, branch).executed == 8 && irq.Reg[9] == 0);
    // A failed first load must preserve its base writeback, PC and full budget.
    Cpu miss; miss.Reg[8] = 4096;
    auto first = Run(miss, block, pages.data(), 4, branch);
    assert(first.executed == 0 && first.original && miss.Reg[8] == 4096);
    const std::array<Word,3> later{0xe2877004, 0xe4d81001, 0xeafffffc};
    assert(Build(later, 0, block));
    auto middle = Run(miss, block, pages.data(), 3, branch);
    assert(middle.executed == 1 && !middle.original && miss.Reg[15] == 4 && miss.Reg[7] == 4);
    for (Word rejected : {0x13a02001u, 0xe082f003u, 0xe08f2003u, 0xe082200fu, 0xe0822374u,
                          0xe4f12001u, 0xe5b11001u, 0xe5812000u, 0xe1a00000u}) {
        Op op;
        assert(!Decode(rejected, op));
    }
    for (Word rejected : {0xebfffffbu, 0xfafffffbu, 0x1afffffcu}) {
        auto modified = words; modified.back() = rejected;
        assert(!Build(modified, 0, block));
    }
}
} // namespace

int main() {
    Arithmetic(); Loads(); Control();
    std::cout << "PASS ARM integer loop arithmetic, memory, IRQ, budget and fallback\n";
}
