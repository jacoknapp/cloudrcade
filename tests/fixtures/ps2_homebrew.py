#!/usr/bin/env python3
"""Generate original PS2 homebrew ELF/ISO for native browser tests (no BIOS/SDK).

Usage: python3 tests/fixtures/ps2_homebrew.py /tmp/ps2-fixture
Writes an animated GS sprite using EE machine code and GIF DMA. The ISO is a
256MiB sparse test disc to exercise range streaming, with no third-party assets.
This is test software executed by the real emulator, not a replacement core.
"""
from pathlib import Path
import struct
import sys

def generate(directory, language_probe=False):
    directory.mkdir(parents=True, exist_ok=True)
    words, labels, fixups = [], {}, []
    def emit(word): words.append(word & 0xffffffff)
    def i(op, rs, rt, immediate): emit(op << 26 | rs << 21 | rt << 16 | immediate & 0xffff)
    def li(rt, value): i(15, 0, rt, value >> 16); i(13, rt, rt, value)
    def label(name): labels[name] = len(words)
    def branch(op, rs, rt, name): fixups.append((len(words), op, rs, rt, name)); emit(0); emit(0)
    def store64(base, offset, value):
        # Build a 64-bit immediate using a temporary register and dsll32.
        li(9, value >> 32); emit(9 << 16 | 9 << 11 | 0x3c)
        li(10, value & 0xffffffff)
        # dsll32/dsrl32 clears sign extension on the low word.
        emit(10 << 16 | 10 << 11 | 0x3c); emit(10 << 16 | 10 << 11 | 0x3e)
        emit(9 << 21 | 10 << 16 | 9 << 11 | 0x25)
        i(63, base, 9, offset)
    # SetGsCrt(interlace=0, NTSC=2, frame=1).
    for rt, value in [(3, 2), (4, 0), (5, 2), (6, 1)]: i(9, 0, rt, value)
    emit(0x0c)
    li(16, 0x12000000)
    store64(16, 0x00, 0x8001) # PMODE: read circuit1, alpha128
    store64(16, 0x70, 10 << 9) # DISPFB1: 640px, RGBA32, framebuffer0
    display = 632 | (50 << 12) | (3 << 23) | (2559 << 32) | (447 << 44)
    store64(16, 0x80, display)
    store64(16, 0xe0, 0x302010)
    li(17, 0x102000); li(18, 0x1000a000); li(19, 0x80403020)
    if language_probe:
        # Ask the actual HLE BIOS for its OSD language, then display that value
        # in the sprite's red channel. This verifies what guest code receives.
        li(4, 0x103000); li(3, 0x4b); emit(0x0c)
        i(35, 4, 19, 0)
        emit(19 << 16 | 19 << 11 | 16 << 6 | 2)  # srl s3,s3,16
        i(12, 19, 19, 31)
        emit(19 << 16 | 19 << 11 | 4 << 6)  # sll s3,s3,4
        i(13, 19, 19, 1)
        li(9, 0x80304000); emit(19 << 21 | 9 << 16 | 19 << 11 | 0x25)
    li(8, 0x1000e000); i(9, 0, 9, 1); i(43, 8, 9, 0) # DMAC master enable
    label('frame')
    # Poll VSync, acknowledge it, then submit a color-changing sprite.
    i(35, 16, 9, 0x1000); i(12, 9, 9, 8); branch(4, 9, 0, 'frame')
    i(9, 0, 9, 8); i(43, 16, 9, 0x1000)
    if not language_probe:
        i(9, 19, 19, 1)
    i(43, 17, 19, 16 * 6)
    i(43, 18, 17, 0x10); i(9, 0, 9, 9); i(43, 18, 9, 0x20)
    i(9, 0, 9, 0x101); i(43, 18, 9, 0)
    label('dma')
    i(35, 18, 9, 0); i(12, 9, 9, 0x100); branch(5, 9, 0, 'dma')
    branch(4, 0, 0, 'frame')
    for at, op, rs, rt, name in fixups:
        words[at] = op << 26 | rs << 21 | rt << 16 | (labels[name] - at - 1) & 0xffff
    code = struct.pack('<' + 'I' * len(words), *words)
    # GIF packed A+D: frame, origin, scissor, tests, sprite, RGBAQ, two vertices.
    registers = [(10 << 16, 0x4c), (0, 0x18), (639 << 16 | 447 << 48, 0x40),
                 (0, 0x47), (6, 0x00), (0x80403020, 0x01),
                 (0, 0x05), (640 * 16 | (448 * 16 << 16), 0x05)]
    packet = struct.pack('<QQ', 8 | 1 << 15 | 1 << 60, 0xe)
    packet += b''.join(struct.pack('<QQ', value, register) for value, register in registers)
    payload = code.ljust(0x2000, b'\0') + packet
    ident = b'\x7fELF\x01\x01\x01' + bytes(9)
    header = ident + struct.pack('<HHIIIIIHHHHHH', 2, 8, 1, 0x100000, 52, 0, 0x20924001, 52, 32, 1, 0, 0, 0)
    program = struct.pack('<IIIIIIII', 1, 0x1000, 0x100000, 0x100000, len(payload), len(payload), 7, 0x1000)
    elf = (header + program).ljust(0x1000, b'\0') + payload
    (directory / 'cloudrcade.elf').write_bytes(elf)
    def both32(value): return struct.pack('<I', value) + struct.pack('>I', value)
    def both16(value): return struct.pack('<H', value) + struct.pack('>H', value)
    def record(name, sector, length, flags=0):
        count = 33 + len(name); count += count % 2
        return bytes([count, 0]) + both32(sector) + both32(length) + bytes([126, 1, 1, 0, 0, 0, 0, flags, 0, 0]) + both16(1) + bytes([len(name)]) + name + bytes(count - 33 - len(name))
    config = b'BOOT2 = cdrom0:\\CLOUD.ELF;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n'
    image = bytearray(32 * 2048)
    pvd = memoryview(image)[16 * 2048:17 * 2048]
    pvd[:7] = b'\x01CD001\x01';pvd[8:40] = b'CLOUDRCADE'.ljust(32);pvd[40:72] = b'ORIGINAL PS2 HOMEBREW'.ljust(32)
    pvd[80:88] = both32(256 * 1024**2 // 2048);pvd[120:124] = both16(1);pvd[124:128] = both16(1);pvd[128:132] = both16(2048)
    pvd[132:140] = both32(10);pvd[140:144] = struct.pack('<I',18);pvd[148:152] = struct.pack('>I',19)
    pvd[156:190] = record(b'\0', 20, 2048, 2);pvd[881] = 1
    image[17 * 2048:17 * 2048 + 7] = b'\xffCD001\x01'
    image[18*2048:18*2048+10] = bytes([1,0])+struct.pack('<IH',20,1)+bytes(2)
    image[19*2048:19*2048+10] = bytes([1,0])+struct.pack('>IH',20,1)+bytes(2)
    root = record(b'\0', 20, 2048, 2) + record(b'\1', 20, 2048, 2) + record(b'SYSTEM.CNF;1', 21, len(config)) + record(b'CLOUD.ELF;1', 22, len(elf))
    image[20 * 2048:20 * 2048 + len(root)] = root
    image[21 * 2048:21 * 2048 + len(config)] = config
    image[22 * 2048:22 * 2048 + len(elf)] = elf
    with (directory / 'cloudrcade.iso').open('wb') as stream:
        stream.write(image);stream.truncate(256 * 1024**2)
    print('Generated original PS2 ELF and 256MiB sparse ISO in ' + str(directory))

if __name__ == '__main__':
    generate(Path(sys.argv[1]), language_probe='--language' in sys.argv[2:])
