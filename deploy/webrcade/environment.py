"""Read the operator's dotenv file without evaluating shell code."""
import os, shlex
from pathlib import Path

def load_environment():
    path = Path(os.environ.get('WEBRCADE_ENV_FILE', str(Path(__file__).with_name('webrcade.env'))))
    if not path.is_file(): return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'): continue
        if line.startswith('export '): line = line[7:]
        name, separator, value = line.partition('=')
        if not separator or not name.replace('_', '').isalnum(): raise ValueError('Invalid environment assignment')
        values = shlex.split(value, comments=True)
        if len(values) > 1: raise ValueError('Quote environment values containing spaces')
        os.environ.setdefault(name, values[0] if values else '')

def env_bool(name, default=False):
    return os.environ.get(name, str(default)).lower().strip() in ('1', 'true', 'yes', 'on')
