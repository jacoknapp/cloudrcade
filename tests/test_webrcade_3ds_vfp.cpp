#include "common/logging/log.h"
#include "core/arm/skyeye_common/vfp/vfp.h"
#include <array>
#include <cstdio>
#include <cstdlib>
#include <random>

// Both copies of vfpsingle.cpp use the actual register accessors and exception
// handling. Only the test's copy without __EMSCRIPTEN__ has renamed entry points.
u32 reference_single_cpdo(ARMul_State*, u32, u32);

void Common::Log::FmtLogMessageImpl(Class, Level level, const char*, unsigned int, const char*,
                                    fmt::string_view, const fmt::format_args&) {
    if (level == Level::Critical) std::abort();
}

struct Registers {
    unsigned n, m, d;
};

struct Result {
    u32 bits, exceptions;
    bool operator==(const Result&) const = default;
};

static unsigned checked;

static Result Check(u32 op, u32 n, u32 m, u32 d, u32 fpscr, Registers regs = {3, 5, 7}) {
    const u32 inst = 0xee000a00 | op | ((regs.d >> 1) << 12) | ((regs.d & 1) << 22) |
                     ((regs.n >> 1) << 16) | ((regs.n & 1) << 7) | (regs.m >> 1) |
                     ((regs.m & 1) << 5);
    ARMul_State expected{};
    for (unsigned i = 0; i < expected.ExtReg.size(); ++i)
        expected.ExtReg[i] = 0x3f800000u ^ (i * 864210u);
    expected.ExtReg[regs.n] = n;
    expected.ExtReg[regs.m] = m;
    expected.ExtReg[regs.d] = d;
    expected.VFP[VFP_FPSCR] = fpscr;
    auto actual = expected;
    const u32 reference_flags = reference_single_cpdo(&expected, inst, fpscr);
    const u32 actual_flags = vfp_single_cpdo(&actual, inst, fpscr);
    vfp_raise_exceptions(&expected, reference_flags, inst, fpscr);
    vfp_raise_exceptions(&actual, actual_flags, inst, fpscr);
    if (actual_flags != reference_flags || actual != expected) {
        std::fprintf(stderr, "VFP mismatch #%u inst=%08x FPSCR=%08x n=%08x m=%08x d=%08x. "
                     "Expected result=%08x exceptions=%08x, got result=%08x exceptions=%08x\n",
                     checked, inst, fpscr, n, m, d, expected.ExtReg[regs.d], reference_flags,
                     actual.ExtReg[regs.d], actual_flags);
        std::abort();
    }
    ++checked;
    return {actual.ExtReg[regs.d], actual_flags};
}

int main() {
    constexpr std::array<u32, 4> modes{
        FPSCR_ROUND_NEAREST, FPSCR_ROUND_PLUSINF, FPSCR_ROUND_MINUSINF, FPSCR_ROUND_TOZERO};
    constexpr std::array<u32, 22> edges{
        0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000, 0x80800000,
        0x33800000, 0x3f7ffffe, 0x3f7fffff, 0x3f800000, 0xbf800000, 0x3f800001,
        0x3fc00000, 0x40000000, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000,
        0x7fc54321, 0x7f854321, 0xffffffff};

    // Independent expected results also pin two tie cases and signed zero.
    if (Check(FOP_FMAC, 0x33800000, 0x3f800000, 0x3f800000, FPSCR_ROUND_NEAREST) !=
            Result{0x3f800000, FPSCR_IXC} ||
        Check(FOP_FMAC, 0x33800000, 0x3f800000, 0x3f800001, FPSCR_ROUND_NEAREST) !=
            Result{0x3f800002, FPSCR_IXC} ||
        Check(FOP_FMAC, 0x3f800000, 0x3f800000, 0xbf800000, FPSCR_ROUND_MINUSINF) !=
            Result{0x80000000, 0}) {
        std::fputs("VFP tie-to-even or signed-zero regression\n", stderr);
        return 1;
    }

    for (const u32 mode : modes) {
        // Exact cancellation, a product cancelled below float precision, and
        // halfway rounding with an even and an odd low bit in the accumulator.
        Check(FOP_FMAC, 0x3f800000, 0x3f800000, 0xbf800000, mode);
        Check(FOP_FMAC, 0x3f800001, 0x3f7ffffe, 0xbf800000, mode);
        Check(FOP_FMAC, 0x33800000, 0x3f800000, 0x3f800000, mode);
        Check(FOP_FMAC, 0x33800000, 0x3f800000, 0x3f800001, mode);

        for (const u32 n : edges) for (const u32 m : edges) {
            for (const u32 controls : {0u, u32(FPSCR_DEFAULT_NAN | FPSCR_FLUSH_TO_ZERO)}) {
                for (const u32 op : {FOP_FMUL, FOP_FADD, FOP_FSUB})
                    Check(op, n, m, 0, mode | controls);
                for (const u32 d : edges) Check(FOP_FMAC, n, m, d, mode | controls);
            }
        }
    }

    // Check the exact-double path on both sides of its exponent limits.
    for (const u32 n : {0x3f800001u, 0xbf800001u}) {
        for (const unsigned distance : {28u, 29u, 30u, 31u}) {
            const u32 m = (127u - distance) << 23 | 0x7fffffu;
            Check(FOP_FADD, n, m, 0, FPSCR_ROUND_NEAREST);
            Check(FOP_FSUB, n, m, 0, FPSCR_ROUND_NEAREST);
        }
    }
    for (const unsigned exponent : {1u, 2u, 253u, 254u}) {
        const u32 word = exponent << 23 | 0x7fffffu;
        Check(FOP_FMUL, word, 0x3f800001, 0, FPSCR_ROUND_NEAREST);
        Check(FOP_FADD, word, word, 0, FPSCR_ROUND_NEAREST);
        Check(FOP_FSUB, word, word, 0, FPSCR_ROUND_NEAREST);
    }

    // A nonzero destination bank enables short vectors. Exercise all lengths
    // and both strides, including overlapping source/destination lanes.
    for (unsigned length = 0; length < 8; ++length) {
        for (const u32 stride : {0u, u32(FPSCR_STRIDE_MASK)}) {
            for (const Registers regs : {Registers{3, 5, 7}, {8, 16, 24}, {9, 9, 9}, {15, 7, 14}}) {
                for (const u32 op : {FOP_FMUL, FOP_FMAC, FOP_FADD, FOP_FSUB})
                    Check(op, 0x3f800001, 0xbf000000, 0x40000001,
                          (length << FPSCR_LENGTH_BIT) | stride, regs);
            }
        }
    }

    std::mt19937 random(1975);
    for (unsigned i = 0; i < 50000; ++i) {
        const u32 n = random(), m = random(), d = random();
        const u32 fpscr = i % 3 == 0 ? static_cast<u32>(random()) : 0;
        const Registers regs{u32(random() % 32), u32(random() % 32), u32(random() % 32)};
        constexpr std::array<u32, 4> ops{FOP_FMUL, FOP_FMAC, FOP_FADD, FOP_FSUB};
        Check(ops[i % ops.size()], n, m, d, fpscr, regs);
    }
    std::printf("PASS %u VFP comparisons of register files, exception masks and cumulative FPSCR\n",
                checked);
}
