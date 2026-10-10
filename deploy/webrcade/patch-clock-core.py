#!/usr/bin/env python3
"""Expose libretro memory accessors in the pinned SameBoy WASM, without changing code."""
import hashlib

SAMEBOY_SHA256 = 'eaf0124401eb48e7705dd35831d9878dbfea8e6e667ed99d5fbe0929fb8a8960'

def leb(value):
    out = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        out.append(byte | (128 if value else 0))
        if not value:
            return bytes(out)

def read_leb(data, offset):
    value = shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, offset
        shift += 7

def patch_sameboy(data):
    if hashlib.sha256(data).hexdigest() != SAMEBOY_SHA256:
        raise ValueError('SameBoy core changed: audit libretro memory exports before upgrading')
    result = bytearray(data[:8])
    offset = 8
    patched = False
    while offset < len(data):
        section = data[offset]
        size, start = read_leb(data, offset + 1)
        body = data[start:start + size]
        offset = start + size
        if section == 7:
            count, pos = read_leb(body, 0)
            additions = b''
            # Verified against this exact binary and the libretro API:
            # unsigned retro_get_memory_size(unsigned), void *retro_get_memory_data(unsigned).
            for name, index in [('wrcad_memory_size', 2056), ('wrcad_memory_data', 2057)]:
                name = name.encode()
                additions += leb(len(name)) + name + b'\0' + leb(index)
            body = leb(count + 2) + body[pos:] + additions
            patched = True
        result += bytes([section]) + leb(len(body)) + body
    if not patched:
        raise ValueError('Missing WASM export section')
    return bytes(result)
