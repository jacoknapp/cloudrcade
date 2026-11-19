#include "video_core/pica/primitive_assembly.h"
#include "video_core/renderer_opengl/wasm_cold_vertices.h"
#include "common/logging/log.h"
#include <array>
#include <cassert>
#include <cstdlib>
#include <iostream>
#include <vector>

// The standalone test links the actual assembler. Its only logging path handles
// an invalid enum, which is an error in the fixture.
namespace Common::Log {
void FmtLogMessageImpl(Class, Level, const char*, unsigned, const char*, fmt::string_view,
                       const fmt::format_args&) {
    std::abort();
}
} // namespace Common::Log

int main() {
    using Mode = Pica::PipelineRegs::TriangleTopology;
    using OpenGL::WasmColdVertices;
    for (const auto mode : {Mode::List, Mode::Shader, Mode::Strip, Mode::Fan}) {
        Pica::PrimitiveAssembler assembler(mode);
        assert(assembler.IsEmpty());
        std::vector<std::array<int, 3>> triangles;
        auto collect = [&](const auto& a, const auto& b, const auto& c) {
            triangles.push_back({int(a.pos.x.ToFloat32()), int(b.pos.x.ToFloat32()),
                                 int(c.pos.x.ToFloat32())});
        };
        for (int i = 0; i < 6; ++i) {
            Pica::OutputVertex vertex{};
            vertex.pos.x = Pica::f24::FromFloat32(i);
            assembler.SubmitVertex(vertex, collect);
        }
        const bool independent = mode == Mode::List || mode == Mode::Shader;
        assert(WasmColdVertices::EligibleDraw(6, mode) == independent);
        assert(WasmColdVertices::EligibleDraw(63, mode) == independent);
        assert(!WasmColdVertices::EligibleDraw(0, mode));
        assert(!WasmColdVertices::EligibleDraw(4, mode));
        assert(!WasmColdVertices::EligibleDraw(66, mode));
        assert(assembler.IsEmpty() == independent);
        if (independent) {
            const std::vector<std::array<int, 3>> expected{{0, 1, 2}, {3, 4, 5}};
            assert(triangles == expected);
        } else {
            assert(triangles.size() == 4);
        }
    }
    std::cout << "PASS guest topology, triangle order, incomplete primitives and vertex limits\n";
}
