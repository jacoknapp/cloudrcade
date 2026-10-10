#!/usr/bin/env python3
"""Remove upstream preset key data without copying it into our patches or artifacts."""
import argparse
from pathlib import Path
import re
import subprocess


def patch(root):
    key = root / 'src/core/hw/aes/key.cpp'
    cmake = root / 'src/core/CMakeLists.txt'
    source = key.read_text()
    begin = source.index('std::istringstream GetKeysStream() {')
    end = source.index('\nvoid InitKeys(', begin)
    original = source[begin:end]
    if original.count('default_keys_enc') != 2 or original.count('default_keys_enc_size') != 1:
        raise ValueError('Pinned upstream key loader changed')
    source = source[:begin] + '''std::istringstream GetKeysStream() {
    const std::string filepath = FileUtil::GetUserPath(FileUtil::UserPath::SysDataDir) + KEYS_FILE;
    boost::iostreams::stream<boost::iostreams::file_descriptor_source> file;
    FileUtil::OpenFStream<std::ios_base::in>(file, filepath);
    if (file.is_open()) {
        return std::istringstream(std::string(std::istreambuf_iterator<char>(file), {}));
    }
    // Operator keys are loaded at runtime. Missing keys never select a bundled set.
    return std::istringstream();
}
''' + source[end:]
    include = '#include "core/hw/default_keys.h"\n'
    if source.count(include) != 1: raise ValueError('Unexpected preset-key include')
    source = source.replace(include, '')
    # Citra supplies the key-scrambler's mathematical constant as emulation code,
    # while key slots come from operator files. Azahar moved this constant into
    # its preset blob; restore Citra's default so ordinary aes_keys.txt files work.
    # Reference: libretro/citra src/core/hw/aes/key.cpp, generator_constant.
    source = source.replace('AESKey generator_constant;', '''AESKey generator_constant = {{0x1F, 0xF9, 0xE9, 0xAA, 0xC5, 0xFE, 0x04, 0x08,
                              0x02, 0x45, 0x91, 0xDC, 0x5D, 0x52, 0x76, 0x8A}};''')
    source = source.replace('LOG_ERROR(HW_AES, "Failed to parse {}", line);',
                            'LOG_ERROR(HW_AES, "Failed to parse key file entry");')
    source = source.replace('LOG_ERROR(HW_AES, "Invalid key {}: {}", parts[1], e.what());',
                            'LOG_ERROR(HW_AES, "Invalid key file value");')
    if 'default_keys' in source: raise ValueError('Preset-key reference remains')
    build = cmake.read_text()
    entry = '    hw/default_keys.h\n'
    if build.count(entry) != 1: raise ValueError('Unexpected preset-key build entry')
    cmake.write_text(build.replace(entry, ''))
    key.write_text(source)
    (root / 'src/core/hw/default_keys.h').unlink()
    # RSA/ECC also share the operator key file. Malformed input must not log values.
    for name in ('rsa/rsa.cpp', 'ecc.cpp'):
        path = root / 'src/core/hw' / name
        text = path.read_text()
        text = text.replace('LOG_ERROR(HW_RSA, "Failed to parse {}", line);',
                            'LOG_ERROR(HW_RSA, "Failed to parse key file entry");')
        text = text.replace('LOG_ERROR(HW_RSA, "Invalid key {}: {}", parts[1], e.what());',
                            'LOG_ERROR(HW_RSA, "Invalid key file value");')
        path.write_text(text)


def verify(root, artifacts):
    # Read only the pinned upstream Git object for comparison; never copy key data
    # into a patch, distribution or diagnostic output.
    header = subprocess.check_output(['git', '-C', str(root), 'show',
                                      'HEAD:src/core/hw/default_keys.h'], text=True)
    array = re.search(r'default_keys_enc\[\d+\]\s*=\s*\{(.*?)\};', header, re.S)
    if not array: raise ValueError('Upstream key-blob declaration changed')
    blob = bytes(int(v, 16) for v in re.findall(r'0x([0-9a-fA-F]{2})', array[1]))
    if len(blob) < 64: raise ValueError('Could not identify upstream key-blob data')
    if (root / 'src/core/hw/default_keys.h').exists(): raise ValueError('Preset key header remains')
    for path in artifacts:
        if blob[:64] in path.read_bytes():
            raise ValueError('Bundled preset-key data found in built artifact')
    print('PASS upstream preset-key header removed and blob absent from built artifacts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--verify', nargs='+', type=Path)
    args = parser.parse_args()
    if args.verify: verify(args.root, args.verify)
    else: patch(args.root)
