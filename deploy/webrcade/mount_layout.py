"""Map the config and ROM mounts to existing server paths and public URLs."""
from pathlib import Path


def configure_mounts(config=Path('/config'), roms=Path('/roms')):
    # Older deployments may still mount the individual paths directly.
    if not config.is_dir():
        return
    if not roms.is_dir():
        raise RuntimeError('The /roms mount is required with /config')
    for name in ['data/feeds', 'data/derived', 'data/metadata', 'tls']:
        (config / name).mkdir(parents=True, exist_ok=True)
    import os
    os.chown(config/'data/metadata', 33, 33)
    (config/'data/metadata').chmod(0o750)
    aliases = {
        '/data': config / 'data',
        '/var/www/html/content': roms,
        '/var/www/html/derived': config / 'data/derived',
        '/var/www/html/managed': roms / 'managed',
        '/usr/local/apache2/conf/ssl': config / 'tls',
        '/run/cloudrcade/3ds': roms / '3DS/bios',
        '/run/cloudrcade/config/config.json': config / 'metadata.json',
    }
    for name, destination in aliases.items():
        alias = Path(name)
        if alias.is_symlink() and alias.readlink() == destination:
            continue
        if alias.is_mount():
            raise RuntimeError('Use config and ROM mounts without legacy path mounts')
        if alias.is_symlink():
            alias.unlink()
        elif alias.is_dir():
            # Never replace a nonempty directory containing operator data.
            alias.rmdir()
        elif alias.exists():
            raise RuntimeError('A layout alias would replace an existing file')
        alias.parent.mkdir(parents=True, exist_ok=True)
        alias.symlink_to(destination)
