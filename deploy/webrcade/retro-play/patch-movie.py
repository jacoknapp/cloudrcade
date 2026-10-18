#!/usr/bin/env python3
"""Apply bounded movie-path changes only to pinned build-scratch sources."""
from pathlib import Path
import hashlib
import sys

root = Path(sys.argv[1])
here = Path(__file__).resolve().parent
source = root / 'deps/Framework/src/idct/IEEE1180.cpp'
assert hashlib.sha256(source.read_bytes()).hexdigest() == '3113cb12686ab67df133f9843517431ba4aef54e0f07015c9263dba467c6e5a9', 'Pinned scalar IDCT changed'
source.write_bytes((here / 'native/IEEE1180.cpp').read_bytes())
# Narrow code-generation change; no global fast-math, contraction or SIMD flags.
framework_cmake = root / 'deps/Framework/build_cmake/Framework/CMakeLists.txt'
with framework_cmake.open('a') as f:
 f.write('''
# CloudRcade ordered f64x2 IDCT; preserve scalar multiplication/addition order.
if(EMSCRIPTEN)
 set_source_files_properties(../../src/idct/IEEE1180.cpp PROPERTIES COMPILE_OPTIONS "-msimd128;-ffp-contract=off")
endif()
''')
# Movie metrics share the timing gate header; no execution hooks are installed.
(root / 'Source/CloudCpuTiming.h').write_bytes((here / 'native/CpuTiming.h').read_bytes())
(root / 'Source/CloudMovieMetrics.h').write_bytes((here / 'native/CloudMovieMetrics.h').read_bytes())
p = root / 'Source/ee/IPU.cpp'
text = p.read_text()
def edit(old, new):
 global text
 assert text.count(old) == 1, 'Pinned IPU source changed: ' + old
 text = text.replace(old, new)
edit('#include "IPU.h"', '#include "IPU.h"\n#include "../CloudMovieMetrics.h"')
edit('\t\t\tif((m_codedBlockPattern & (1 << (5 - m_currentBlockIndex))))',
 '\t\t\tCloudMovieMetrics::Block((m_codedBlockPattern & (1 << (5 - m_currentBlockIndex))) != 0);\n\t\t\tif((m_codedBlockPattern & (1 << (5 - m_currentBlockIndex))))')
edit('\t\t\tIDCT::CIEEE1180::GetInstance()->Transform(blockTemp, blockInfo.block);',
 '\t\t\tCloudMovieMetrics::Scope movieIdctScope(blockTemp);\n\t\t\tIDCT::CIEEE1180::GetInstance()->Transform(blockTemp, blockInfo.block);')
edit('\t\t\tuint32 nPixel[0x100];', '\t\t\tCloudMovieMetrics::Scope movieCscScope(nullptr);\n\t\t\tuint32 nPixel[0x100];')
p.write_text(text)
