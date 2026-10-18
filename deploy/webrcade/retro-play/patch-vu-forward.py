#!/usr/bin/env python3
"""Keep a computed VU result live for its immediately following flag test."""
from pathlib import Path
import re
import sys


def patch(root):
    path = Path(root) / 'Source/ee/VUShared.cpp'
    text = path.read_text()
    old = '''void VUShared::TestSZFlags(CMipsJitter* codeGen, uint8 dest, size_t regOffset, uint32 relativePipeTime, uint32 compileHints)
{
\tcodeGen->MD_PushRel(regOffset);
\tcodeGen->MD_MakeSignZero();'''
    new = '''static void TestSZFlagsValue(CMipsJitter* codeGen, uint8 dest, uint32 relativePipeTime, uint32 compileHints)
{
\tcodeGen->MD_MakeSignZero();'''
    if text.count(old) != 1:
        raise ValueError('Pinned VU flag producer changed')
    text = text.replace(old, new)
    marker = '\nvoid VUShared::GetStatus('
    helper = '''
void VUShared::TestSZFlags(CMipsJitter* codeGen, uint8 dest, size_t regOffset, uint32 relativePipeTime, uint32 compileHints)
{
\tcodeGen->MD_PushRel(regOffset);
\tTestSZFlagsValue(codeGen, dest, relativePipeTime, compileHints);
}

static void PullVectorAndTestSZFlags(CMipsJitter* codeGen, uint8 dest, size_t regOffset, uint32 relativePipeTime, uint32 compileHints)
{
#ifdef __EMSCRIPTEN__
\tif(dest != 0)
\t{
\t\t// Keep the computed value in a Wasm local, while committing the guest
\t\t// vector at the original point. TestSZFlagsValue clears inactive lanes,
\t\t// so a partial write's untouched destination lanes are never consumed.
\t\tcodeGen->PushTop();
\t\tVUShared::PullVector(codeGen, dest, regOffset);
\t\tTestSZFlagsValue(codeGen, dest, relativePipeTime, compileHints);
\t\treturn;
\t}
#endif
\tVUShared::PullVector(codeGen, dest, regOffset);
\tVUShared::TestSZFlags(codeGen, dest, regOffset, relativePipeTime, compileHints);
}
'''
    if text.count(marker) != 1:
        raise ValueError('Pinned VU flag boundary changed')
    text = text.replace(marker, helper + marker)
    # Only adjacent vector commit + flag-test pairs qualify. Scalar writers,
    # accurate-ADDi paths, and standalone flag readers retain their old path.
    pattern = re.compile(r'(?m)^(\t+)PullVector\(codeGen, (dest|nDest), ([^\n]+)\);\n\1TestSZFlags\(codeGen, \2, \3, relativePipeTime, compileHints\);')
    count = 0
    def replace_pair(match):
        nonlocal count
        # ADDbc's add-with-VF0 fast path pushes a relative symbol, not an
        # immutable computed temporary. Leave that move path unchanged.
        if match[3] == 'offsetof(CMIPS, m_State.nCOP2[fd])':
            return match[0]
        count += 1
        return (match[1] + 'PullVectorAndTestSZFlags(codeGen, ' + match[2] + ', ' +
                match[3] + ', relativePipeTime, compileHints);')
    text = pattern.sub(replace_pair, text)
    if count != 11:
        raise ValueError('Pinned VU producer/flag pair count changed: ' + str(count))
    path.write_text(text)


if __name__ == '__main__':
    patch(sys.argv[1])
