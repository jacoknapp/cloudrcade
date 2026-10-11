#!/usr/bin/env python3
"""Serve the generated GameCube lab on localhost with shared-memory headers.

Usage: python3 serve.py [release/gamecube/app] [port]. The default port is
18572. This development server binds only 127.0.0.1 and writes no game data.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
import sys
import os


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def send_head(self):
        self.range_remaining = None
        requested = self.headers.get('Range')
        if not requested:
            return super().send_head()
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            return super().send_head()
        stream = path.open('rb')
        stat = os.fstat(stream.fileno())
        size = stat.st_size
        etag = f'"{stat.st_ino:x}-{size:x}-{stat.st_mtime_ns:x}"'
        if self.headers.get('If-Range') not in (None, etag):
            stream.close()
            return super().send_head()
        match = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
        first = int(match[1]) if match else size
        last = min(int(match[2]) if match and match[2] else size - 1, size - 1)
        if first > last or first >= size:
            stream.close()
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        stream.seek(first)
        self.range_remaining = last - first + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('ETag', etag)
        self.send_header('Content-Range', f'bytes {first}-{last}/{size}')
        self.send_header('Content-Length', str(self.range_remaining))
        self.end_headers()
        return stream

    def copyfile(self, source, outputfile):
        if self.range_remaining is None:
            return shutil.copyfileobj(source, outputfile)
        remaining = self.range_remaining
        while remaining:
            block = source.read(min(remaining, 65536))
            if not block:
                break
            outputfile.write(block)
            remaining -= len(block)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    default = Path(__file__).resolve().parents[3] / 'release/gamecube/app'
    root = Path(sys.argv[1] if len(sys.argv) > 1 else default).resolve()
    if not (root / 'core-info.json').is_file():
        raise SystemExit('Prepare the prototype before serving it')
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 18572
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(root)))
    print(f'GameCube lab: http://127.0.0.1:{port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
