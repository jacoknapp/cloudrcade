"""Publish PPSSPP runtime assets and a deterministic MEMFS installation manifest."""
from pathlib import Path
import json
import shutil
import sys
source, target = map(Path, sys.argv[1:])
records = []
for path in sorted(source.rglob('*')):
    if not path.is_file() or '.git' in path.parts or 'debugger' in path.relative_to(source).parts:
        continue
    relative = path.relative_to(source)
    output = target/relative
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, output)
    records.append(relative.as_posix())
(target/'manifest.json').write_text(json.dumps(records, separators=(',', ':')) + '\n')
