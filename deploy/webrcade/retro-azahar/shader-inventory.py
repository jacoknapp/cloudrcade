#!/usr/bin/env python3
"""Read-only shader inventory. Python 3 standard library; see README.md.

ROM mode inventories native Game Freak shader command streams, NOT ready-to-load
WebGL programs. Cache mode inventories the port's already translated GLSL records.
Format references: gdkchan/SPICA (GFShader, GFPackage), kwsch/pk3DS (GARC), and
Azahar's NCCH/RomFS readers. No game data is included in this tool.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import struct
import sys
import time
import urllib.request


def require(condition, message):
    if not condition:
        raise ValueError(message)


def u32(data, offset=0):
    return struct.unpack_from('<I', data, offset)[0]


class Reader:
    def __init__(self, source):
        self.source = source
        self.remote = source.startswith(('http://', 'https://'))

    def read(self, offset, size):
        require(offset >= 0 and 0 <= size <= 64 * 1024 * 1024, 'Invalid read size')
        if not size:
            return b''
        if self.remote:
            request = urllib.request.Request(self.source, headers={
                'Range': f'bytes={offset}-{offset + size - 1}', 'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(request, timeout=60) as response:
                require(response.status == 206, 'Server must support HTTP byte ranges')
                expected = f'bytes {offset}-{offset + size - 1}/'
                require(response.headers.get('Content-Range', '').startswith(expected),
                        'Wrong HTTP byte range returned')
                data = response.read(size + 1)
        else:
            with open(self.source, 'rb') as stream:
                stream.seek(offset)
                data = stream.read(size)
        require(len(data) == size, 'Truncated input')
        return data


def romfs(reader):
    header = struct.unpack('<IHHIIIIQ', reader.read(0, 32))
    content = sum((v + 63) & ~63 for v in (header[0], *header[3:6]))
    ncch = reader.read(content, 512)
    require(ncch[256:260] == b'NCCH', 'Expected CIA with a program NCCH first')
    require(ncch[0x18f] & 4, 'This scanner requires decrypted NCCH content')
    require(ncch[0x18e] == 0, 'Unsupported NCCH block size')
    ivfc = content + u32(ncch, 0x1b0) * 512
    require(reader.read(ivfc, 4) == b'IVFC', 'Missing RomFS IVFC header')
    # Standard NCCH RomFS Level 3 layout, also used by Azahar's reader.
    base = ivfc + 0x1000
    h = struct.unpack('<10I', reader.read(base, 40))
    require(h[0] == 40, 'Unsupported RomFS header')
    dirs = reader.read(base + h[3], h[4])
    files = reader.read(base + h[7], h[8])
    result, seen_dirs, seen_files = [], set(), set()

    def walk(directory, path):
        require(directory not in seen_dirs, 'Cyclic RomFS directory')
        seen_dirs.add(directory)
        _, _, child, file, _, length = struct.unpack_from('<6I', dirs, directory)
        name = dirs[directory + 24:directory + 24 + length].decode('utf-16le')
        path += '/' + name if name else ''
        while file != 0xffffffff:
            require(file not in seen_files, 'Cyclic RomFS file chain')
            seen_files.add(file)
            _, nxt, offset, size, _, length = struct.unpack_from('<IIQQII', files, file)
            name = files[file + 32:file + 32 + length].decode('utf-16le')
            result.append(dict(path=path + '/' + name, offset=base + h[9] + offset, size=size))
            file = nxt
        while child != 0xffffffff:
            walk(child, path)
            child = u32(dirs, child + 4)

    walk(0, '')
    return result


def garc(reader, file):
    head = reader.read(file['offset'], 36)
    require(head[:4] == b'CRAG', 'Expected a GARC archive')
    require(struct.unpack_from('<H', head, 10)[0] in (0x400, 0x600), 'Unsupported GARC version')
    data_offset = u32(head, 16)
    require(data_offset <= file['size'], 'GARC metadata exceeds archive')
    data = reader.read(file['offset'], data_offset)
    fato = u32(data, 4)
    require(data[fato:fato + 4] == b'OTAF', 'Missing FATO')
    count = struct.unpack_from('<H', data, fato + 8)[0]
    fatb = fato + u32(data, fato + 4)
    require(data[fatb:fatb + 4] == b'BTAF', 'Missing FATB')
    result = []
    for index in range(count):
        pos = fatb + 12 + u32(data, fato + 12 + index * 4)
        bits = u32(data, pos)
        pos += 4
        for sub in range(32):
            if bits & (1 << sub):
                start, end, size = struct.unpack_from('<III', data, pos)
                pos += 12
                require(start + size <= end and data_offset + end <= file['size'], 'Invalid GARC member')
                result.append(dict(path=f"{file['path']}/{index}:{sub}", index=index,
                                   offset=file['offset'] + data_offset + start, size=size))
    return result


def decompress(data):
    if data[0] != 0x11:
        return data
    size, pos = int.from_bytes(data[1:4], 'little'), 4
    if size == 0:
        size, pos = u32(data, 4), 8
    require(size <= 64 * 1024 * 1024, 'LZ11 expansion exceeds limit')
    out = bytearray()
    while len(out) < size:
        flags = data[pos]
        pos += 1
        for shift in range(7, -1, -1):
            if len(out) >= size:
                break
            if not flags & (1 << shift):
                out.append(data[pos])
                pos += 1
                continue
            a, b = data[pos:pos + 2]
            pos += 2
            n = a >> 4
            if n == 0:
                c = data[pos]
                pos += 1
                length, distance = ((a & 15) << 4) + (b >> 4) + 17, ((b & 15) << 8) + c + 1
            elif n == 1:
                c, d = data[pos:pos + 2]
                pos += 2
                length = ((a & 15) << 12) + (b << 4) + (c >> 4) + 273
                distance = ((c & 15) << 8) + d + 1
            else:
                length, distance = n + 1, ((a & 15) << 8) + b + 1
            require(distance <= len(out), 'Invalid LZ11 back reference')
            require(len(out) + length <= size, 'LZ11 output exceeds declared size')
            period = bytes(out[-distance:])
            out.extend((period * ((length + distance - 1) // distance))[:length])
    return bytes(out)


def package(data):
    if len(data) < 8 or not all(65 <= c <= 90 for c in data[:2]):
        return []
    count = struct.unpack_from('<H', data, 2)[0]
    require(8 + 4 * count <= len(data), 'Truncated package table')
    offsets = struct.unpack_from('<' + str(count + 1) + 'I', data, 4)
    require(offsets[0] >= 8 + 4 * count and offsets[-1] <= len(data)
            and all(a <= b for a, b in zip(offsets, offsets[1:])), 'Invalid package offsets')
    return [data[a:b] for a, b in zip(offsets, offsets[1:])]


def model_shaders(reader, file):
    parts = package(decompress(reader.read(file['offset'], file['size'])))
    if (len(parts) == 5 and not parts[0] and not parts[1]
            and parts[2][:4] == b'PS\0\0' and parts[3][:4] == b'PC\0\0'):
        require(not package(parts[2]) and not package(parts[3]), 'Invalid empty model package')
        return []
    require(parts and parts[0][:4] == bytes.fromhex('17211215'), 'Selected entry is not a supported model')
    result = []
    for block in parts[2:4]:
        for shader in package(block):
            require(shader[16:24].rstrip(b'\0') == b'shader', 'Unsupported shader section')
            length = u32(shader, 0x70)
            commands = shader[0xc0:0xc0 + length]
            require(length % 4 == 0 and len(commands) == length, 'Truncated shader command stream')
            name_bytes = shader[32:96].split(b'\0')[0]
            try:
                name = name_bytes.decode('utf-8')
            except UnicodeDecodeError:
                name = name_bytes.decode('cp932')
            result.append(dict(name=name, source=file['path'],
                               commandBytes=length, sha256=hashlib.sha256(commands).hexdigest()))
    return result


def scan_rom(args):
    reader = Reader(args.cia)
    files = romfs(reader)
    file = next((f for f in files if f['path'] == args.archive), None)
    require(file is not None, 'Archive not found in RomFS')
    entries = garc(reader, file)
    selected = [f for f in entries if f['index'] >= args.first
                and (f['index'] - args.first) % args.stride == 0]
    shaders, errors, empty = [], [], []
    # LZ11 decompression is CPU-bound Python; processes avoid the interpreter lock.
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(model_shaders, reader, f): f for f in selected}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                records = future.result()
                shaders.extend(records)
                if not records:
                    empty.append(futures[future]['path'])
            except Exception as error:
                errors.append(dict(source=futures[future]['path'], error=str(error)))
            if index % 100 == 0:
                print(f'{index}/{len(selected)} models scanned; {len(errors)} errors', file=sys.stderr)
    return dict(kind='native-model-shader-inventory', completeGameCoverage=False,
                webglCache=False, romfsFiles=len(files), archive=args.archive,
                selection=dict(first=args.first, stride=args.stride), archiveMembers=len(entries),
                modelEntriesAttempted=len(selected), shaderDefinitions=len(shaders),
                uniqueCommandStreams=len({s['sha256'] for s in shaders}),
                modelsWithoutShaderRecords=sorted(empty),
                errors=sorted(errors, key=lambda e: e['source']),
                shaders=sorted(shaders, key=lambda s: (s['source'], s['name'], s['sha256'])))


def scan_cache(args):
    data = Path(args.cache).read_bytes()
    require(len(data) >= 27 and data.startswith(b'WRCP1'), 'Expected WRCP1 cache')
    shaders, programs, pos = {}, {}, 27
    while pos < len(data):
        kind, pos = data[pos], pos + 1
        if kind == ord('S'):
            key, shader_type, size = struct.unpack_from('<QII', data, pos)
            pos += 16
            require(pos + size <= len(data), 'Truncated shader source')
            source = data[pos:pos + size]
            pos += size
            record = dict(hash=f'{key:016x}', type=shader_type, sourceBytes=size,
                          sha256=hashlib.sha256(source).hexdigest())
            require(key not in shaders or shaders[key] == record, 'Conflicting shader hash')
            shaders[key] = record
        elif kind == ord('P'):
            key, vertex, fragment = struct.unpack_from('<QQQ', data, pos)
            pos += 24
            record = dict(id=f'{key:016x}', vertex=f'{vertex:016x}', fragment=f'{fragment:016x}')
            require(key not in programs or programs[key] == record, 'Conflicting program ID')
            programs[key] = record
        else:
            raise ValueError(f'Unknown record at offset {pos - 1}')
    missing = sorted({r[k] for r in programs.values() for k in ('vertex', 'fragment')
                      if int(r[k], 16) not in shaders})
    return dict(kind='WRCP1-source-cache-inventory', completeGameCoverage=False,
                stamp=data[:27].rstrip(b'\0').decode(), bytes=len(data),
                programCount=len(programs), vertexShaders=sum(r['type'] == 0x8b31 for r in shaders.values()),
                fragmentShaders=sum(r['type'] == 0x8b30 for r in shaders.values()),
                missingSources=missing, shaders=list(shaders.values()), programs=list(programs.values()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--cia', help='Decrypted CIA path or byte-range HTTP URL')
    source.add_argument('--cache', help='Existing programs.bin to inventory')
    parser.add_argument('--archive', default='/a/0/9/4', help='RomFS archive (default: Ultra Moon models)')
    parser.add_argument('--first', type=int, default=1, help='First model member index')
    parser.add_argument('--stride', type=int, default=9, help='Model member spacing')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    require(args.stride > 0 and args.first >= 0 and 1 <= args.workers <= 16, 'Invalid scan settings')
    source_path = args.cache or args.cia
    if not source_path.startswith(('http://', 'https://')):
        require(Path(source_path).resolve() != args.output.resolve(), 'Output must differ from input')
    start = time.monotonic()
    result = scan_rom(args) if args.cia else scan_cache(args)
    result['elapsedSeconds'] = round(time.monotonic() - start, 2)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('shaders', 'programs')}, indent=2))
    return 2 if result.get('errors') or result.get('missingSources') else 0


if __name__ == '__main__':
    sys.exit(main())
