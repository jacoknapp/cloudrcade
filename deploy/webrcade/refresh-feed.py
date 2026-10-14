#!/usr/bin/env python3
"""Build CloudRcade feeds from the read-only ROM share. Standard library only."""
import datetime, fcntl, hashlib, json, os, re, struct, subprocess, tempfile
from pathlib import Path
from urllib.parse import quote
import runpy
_env = runpy.run_path(str(Path(__file__).with_name('environment.py')))
load_environment, env_bool = _env['load_environment'], _env['env_bool']
load_environment()
cached_item=runpy.run_path(str(Path(__file__).with_name('metadata_lookup.py')))['cached_item']

ROOT = Path(os.environ.get('WEBRCADE_ROM_ROOT', '/var/www/html/content'))
STATE = Path(os.environ.get('WEBRCADE_STATE_PATH', '/data'))
MANAGED = Path(os.environ.get('WEBRCADE_MANAGED_ROOT', '/managed'))
MANAGED_PREFIX = os.environ.get('WEBRCADE_METADATA_PATH_PREFIX', '')
BASE = os.environ.get('WEBRCADE_CONTENT_URL', '/content/').rstrip('/') + '/'
NAMESPACE = os.environ.get('WEBRCADE_STORAGE_PREFIX', 'cloudrcade')
FEED_TITLE = os.environ.get('WEBRCADE_FEED_TITLE', 'CloudRcade')
FEED_DESCRIPTION = os.environ.get('WEBRCADE_FEED_DESCRIPTION', 'Games from your ROM library.')
SYSTEMS = {
 'nes': ('Nintendo Entertainment System', 'nes', {'.nes'}, 18),
 'snes': ('Super Nintendo', 'snes', {'.sfc', '.smc'}, 19),
 'gb': ('Game Boy', 'gb', {'.gb'}, 33),
 'gbc': ('Game Boy Color', 'gbc', {'.gbc'}, 22),
 'gba': ('Game Boy Advance', 'gba', {'.gba'}, 24),
 'n64': ('Nintendo 64', 'n64', {'.z64', '.v64', '.n64'}, 4),
 'nds': ('Nintendo DS', 'retro-melonds', {'.nds'}, 20),
 'segaMD': ('Sega Genesis', 'genesis', {'.bin', '.gen', '.smd', '.md'}, 29),
 'psx': ('PlayStation', 'psx', {'.chd', '.pbp', '.cue'}, 7),
 'psp': ('PlayStation Portable', 'psp', {'.iso', '.cso', '.pbp', '.elf'}, 38),
 '3DS': ('Nintendo 3DS', '3ds', {'.cia', '.3ds', '.cci'}, 37),
 'GameCube': ('Nintendo GameCube', 'gamecube', {'.iso', '.gcm'}, 21),
}

def managed_matches(path,folder,extensions):
 if path.suffix.lower() not in extensions:return False
 if path.suffix.lower()=='.iso':
  if folder=='GameCube':return gamecube_game(path) is not None
  if folder!='psp':return False
  with path.open('rb') as f:return b'PSP_GAME' in f.read(512*1024)
 if path.suffix.lower()=='.bin':
  if folder!='segaMD':return False
  with path.open('rb') as f:f.seek(0x100);return f.read(4)==b'SEGA'
 return True

def gamecube_game(path):
 # Disc identity and format validation need only the header, never a GB hash.
 with path.open('rb') as stream: head=stream.read(0x20)
 if len(head)!=0x20 or head[0x1c:0x20]!=bytes.fromhex('c2339f3d') or head[0x18:0x1c]==bytes.fromhex('5d1c9ea3'): return None
 if not re.fullmatch(b'[A-Z0-9]{6}',head[:6]): return None
 return 'gamecube:'+head[:8].hex()+':'+str(path.stat().st_size)
# The 3DS share mixes games with updates, DLC, homebrew and console backups.
N3DS_SKIP_DIRS = set(filter(None, os.environ.get('WEBRCADE_3DS_SKIP_DIRS', '').split('|')))
N3DS_SKIP_NAMES = set(filter(None, os.environ.get('WEBRCADE_3DS_SKIP_NAMES', '').split('|')))
# Titles that need a seed (seeddb.bin) the emulator does not have.
N3DS_SEED_TITLES = {'0004000000171000', '0004000000171100', '0004000000171200',
 '0004000000172600', '0004000000172700', '0004000000172800'}
N3DS_PLATFORMS = {37, 137}

def atomic(path, data):
 path.parent.mkdir(parents=True, exist_ok=True)
 with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as f:
  json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
  f.write('\n'); f.flush(); os.fsync(f.fileno()); tmp=f.name
 os.chmod(tmp, 0o644); os.replace(tmp, path)

def rom_url(path):
 try: relative=str(path.relative_to(ROOT))
 except ValueError: relative='managed/'+str(path.relative_to(MANAGED))
 return BASE+quote(relative)

def metadata():
 # Existing imported metadata is a local cache, never a live catalog dependency.
 cached=STATE/'metadata-cache.json'
 if not env_bool('WEBRCADE_METADATA_ENABLED') or not cached.is_file(): return []
 rows=json.loads(cached.read_text())
 return rows if isinstance(rows,list) else []

def n3ds_game(path):
 """Return a cheap identity for a bootable 3DS game, or None for anything else."""
 relative=path.relative_to(ROOT/'3DS') if path.is_relative_to(ROOT/'3DS') else path.relative_to(MANAGED)
 if N3DS_SKIP_DIRS.intersection(relative.parts[:-1]) or path.stem in N3DS_SKIP_NAMES: return None
 align=lambda value:(value+63)&~63
 try:
  with path.open('rb') as f:
   head=f.read(0x10000)
   if path.suffix.lower()=='.cia':
    header,_,_,certs,ticket,tmd_size=struct.unpack('<IHHIII',head[:20])
    if header!=0x2020: return None
    tmd=align(header)+align(certs)+align(ticket)
    f.seek(tmd); signature=int.from_bytes(f.read(4),'big')
    length={0x10003:0x240,0x10004:0x140,0x10005:0x80}.get(signature)
    if length is None: return None
    f.seek(tmd+length+0x4C); title=f.read(8).hex()
    # Applications only: no updates (0004000e), DLC (0004008c) or system titles.
    if not title.startswith('00040000') or title in N3DS_SEED_TITLES: return None
   elif head[0x100:0x104]!=b'NCSD': return None
 except OSError: return None
 return 'n3ds:'+hashlib.md5(head).hexdigest()+':'+str(path.stat().st_size)

def digest(path, cache):
 st=path.stat(); key=str(path); signature=[st.st_size, st.st_mtime_ns]
 old=cache.get(key)
 if old and old['stat']==signature: return old['md5']
 h=hashlib.md5()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(4*1024*1024), b''): h.update(block)
 after=path.stat()
 if [after.st_size,after.st_mtime_ns]!=signature: raise RuntimeError('ROM changed during scan: '+str(path))
 value=h.hexdigest(); cache[key]={'stat':signature,'md5':value}; return value

def cue_to_chd(path, cache):
 # Build a corrected local CUE; never edit the source CUE or BIN files.
 cue=path.read_text(encoding='utf-8-sig',errors='replace')
 references=re.findall(r'(?im)^\s*FILE\s+"([^"]+)"\s+\S+',cue)
 if not references: raise ValueError('CUE has no FILE records: '+str(path))
 siblings={p.name.casefold():p for p in path.parent.iterdir() if p.is_file()}
 resolved=[]
 for ref in references:
  candidate=path.parent/ref
  if not candidate.is_file(): candidate=siblings.get(Path(ref).name.casefold())
  if candidate is None or not candidate.is_file(): raise ValueError('Missing CUE track: '+str(path)+' / '+ref)
  resolved.append(candidate)
 if re.search(r'(?m)^\s*TRACK\s+\d+(?:[ \t]+MODE0/2352)?[ \t]*$',cue):
  if len(resolved)!=1: raise ValueError('Ambiguous missing CUE track type: '+str(path))
  with resolved[0].open('rb') as f: header=f.read(16)
  if len(header)!=16 or header[:12]!=b'\x00'+b'\xff'*10+b'\x00' or header[15] not in (1,2) or resolved[0].stat().st_size%2352:
   raise ValueError('Cannot infer CUE track type from sector header: '+str(path))
  cue=re.sub(r'(?m)^(\s*TRACK\s+\d+)(?:[ \t]+MODE0/2352)?[ \t]*$',lambda m:m.group(1)+' MODE'+str(header[15])+'/2352',cue)
 stamp=[digest(path,cache)]+[digest(p,cache) for p in resolved]
 key=hashlib.sha256(('\n'.join(stamp)).encode()).hexdigest()
 target=STATE/'derived'/f'{key}.chd'
 if not target.exists():
  with tempfile.TemporaryDirectory(dir=STATE/'derived') as tmp:
   for i,(ref,p) in enumerate(zip(references,resolved)):
    name=f'track-{i}.bin'; os.symlink(p,Path(tmp)/name)
    cue=cue.replace('"'+ref+'"','"'+name+'"')
   (Path(tmp)/'disc.cue').write_text(cue)
   proc=subprocess.run(['chdman','createcd','-np','4','-i',str(Path(tmp)/'disc.cue'),'-o',str(Path(tmp)/'disc.chd')],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=1800)
   if proc.returncode: raise RuntimeError('CHD conversion failed: '+str(path)+'\n'+proc.stdout[-1500:])
   os.replace(Path(tmp)/'disc.chd',target); os.chmod(target,0o644)
 return BASE+'derived/'+target.name

def main():
 STATE.mkdir(parents=True,exist_ok=True)
 with open(STATE/'refresh.lock','w') as lock:
  try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError: print('Refresh already running'); return
  required = os.environ.get('WEBRCADE_REQUIRED_ROM_DIR', '')
  if not ROOT.is_dir() or (env_bool('WEBRCADE_REQUIRE_ROM_MOUNT') and not os.path.ismount(ROOT.resolve())) or (required and not (ROOT/required).is_dir()):
   raise RuntimeError('ROM share unavailable; retaining previous feeds')
  (STATE/'derived').mkdir(exist_ok=True)
  try:
   rows=metadata(); metadata_source='cached' if rows else 'filenames'
  except (RuntimeError,subprocess.SubprocessError,OSError):
   cached=STATE/'metadata-cache.json'
   rows=json.loads(cached.read_text()) if cached.exists() else []
   metadata_source='cached' if cached.exists() else 'filenames'
   print('Metadata cache unavailable; using '+metadata_source+' metadata',flush=True)
  managed_files=sorted(p for p in MANAGED.rglob('*') if p.is_file()) if MANAGED.is_dir() else []
  managed_platforms={str(MANAGED/r['path'][len(MANAGED_PREFIX):]):r['platform'] for r in rows if MANAGED_PREFIX and r['path'].startswith(MANAGED_PREFIX)}
  by_hash={r['md5'].lower():r for r in rows if r['md5']}
  # 3DS files are several GB; match their metadata by file name instead of hashing them.
  n3ds_by_name={Path(r['path']).name:r for r in rows if r['platform'] in N3DS_PLATFORMS}
  cache_path=STATE/'hash-cache.json'
  cache=json.load(open(cache_path)) if cache_path.exists() else {}
  feed={'title':FEED_TITLE,'description':FEED_DESCRIPTION,'props':{},'categories':[]}
  bios=[ROOT/'psx/bios'/f'scph550{i}.bin' for i in range(3)]
  psp_bios=ROOT/'psx/bios/PSXONPSP660.BIN'
  if psp_bios.is_file() and digest(psp_bios,cache)=='c53ca5908936d412331790f4426c6c33':
   feed['props']['psx_bios']=[rom_url(psp_bios)]
  elif all(p.is_file() for p in bios):
   expected=['8dd7d5296a650fac7319bce665a6a53c','490f666e1afb15b7362b406ed1cea246','32736f17079d0b2b7024407c39bd3050']
   if [digest(p,cache) for p in bios]==expected: feed['props']['psx_bios']=[rom_url(p) for p in bios]
  ds_bios=[ROOT/'nds/bios'/name for name in ('bios7.bin','bios9.bin','firmware.bin')]
  if all(p.is_file() for p in ds_bios): feed['props']['ds_bios']=[BASE+quote(str(p.relative_to(ROOT))) for p in ds_bios]
  # Retain published CUE save IDs, even if a colliding descriptor sorts before
  # the original game or the original temporarily leaves the library.
  ids_path=STATE/'psx-save-ids.json'
  disc_ids=json.loads(ids_path.read_text()) if ids_path.exists() else {}
  previous=STATE/'feeds'/'combined.json'
  published_roms=set()
  if previous.exists():
   for category in json.loads(previous.read_text()).get('categories',[]):
    for item in category.get('items',[]):
     props=item.get('props',{})
     if props.get('rom'): published_roms.add(props['rom'])
     if item.get('type')=='psx' and props.get('uid') and len(props.get('discs',[]))==1:
      disc_ids.setdefault(props['discs'][0],props['uid'])
  reserved_ids={uid:disc for disc,uid in disc_ids.items()}
  counts={}; scanned=0; duplicates=0; seen=set(); errors=[]
  for folder,(title,core,extensions,platform) in SYSTEMS.items():
   if folder == '3DS' and not env_bool('WEBRCADE_ENABLE_3DS'): continue
   if folder == 'GameCube' and not Path('/var/www/html/experimental/gamecube/core-info.json').is_file(): continue
   items=[]
   candidates=sorted((ROOT/folder if folder in ('3DS','GameCube') else ROOT/folder/'roms').rglob('*'))
   candidates += [p for p in managed_files if managed_platforms.get(str(p))==platform or (str(p) not in managed_platforms and managed_matches(p,folder,extensions))]
   # A SNES hack was filed under NES; route it by format.
   if folder=='snes': candidates+=sorted((ROOT/'nes/roms').glob('*.smc'))
   # Keep the published copy when newly discovered duplicates sort earlier.
   candidates.sort(key=lambda p:(rom_url(p) not in published_roms,str(p)))
   for p in candidates:
    if not p.is_file() or p.suffix.lower() not in extensions: continue
    if folder=='GameCube':
     identity=gamecube_game(p)
     if identity is None: continue
     scanned+=1; md5=None; info={}
    elif folder=='3DS':
     identity=n3ds_game(p)
     if identity is None: continue
     scanned+=1; md5=None; info=n3ds_by_name.get(p.name,{})
    else:
     scanned+=1
     md5=digest(p,cache)
     identity=md5; info=by_hash.get(md5,{})
    display=p.stem
    props={'rom':rom_url(p)}
    if folder=='psx':
     if not feed['props'].get('psx_bios'): raise RuntimeError('PlayStation BIOS set missing')
     try: disc=cue_to_chd(p,cache) if p.suffix.lower()=='.cue' else props['rom']
     except (ValueError,RuntimeError,subprocess.TimeoutExpired) as e:
      errors.append(str(e)); continue
     uid=NAMESPACE+'-psx-'+md5
     if p.suffix.lower()=='.cue':
      # Derived URL hashes both the descriptor AND all referenced track bytes.
      identity='cue:'+disc
      uid=disc_ids.get(disc) or uid
      if uid in reserved_ids and reserved_ids[uid]!=disc:
       uid=NAMESPACE+'-psx-'+md5+'-'+hashlib.sha256(disc.encode()).hexdigest()[:16]
      disc_ids[disc]=uid; reserved_ids[uid]=disc
     props={'uid':uid,'discs':[disc]}
    if identity in seen: duplicates+=1; continue
    seen.add(identity)
    item={'title':display,'type':core,'props':props}
    if info.get('game') and info.get('title'):
     item['longTitle']=info['title']+' — '+display
     if info.get('summary'): item['description']=info['summary']
     if info.get('cover'): item['thumbnail']='https://images.igdb.com/igdb/image/upload/t_cover_big/'+info['cover']+'.jpg'
    item.update(cached_item(item, STATE/'metadata'))
    items.append(item)
   print(folder, len(items), 'entries', flush=True)
   atomic(cache_path,cache)
   if items:
    category={'title':title,'items':items}; feed['categories'].append(category)
    counts[folder]=len(items)
  atomic(cache_path,cache)
  if errors:
   atomic(STATE/'refresh-errors.json',errors)
   raise RuntimeError(f'{len(errors)} disc conversion errors; retaining previous feeds. See refresh-errors.json')
  if not feed['categories']: raise RuntimeError('Empty scan; retaining previous feeds')
  atomic(ids_path,disc_ids)
  # Publish combined last. Consumers always see a complete JSON document.
  for category,folder in zip(feed['categories'],counts):
   atomic(STATE/'feeds'/f'{folder}.json',dict(feed,categories=[category]))
  atomic(STATE/'feeds'/'combined.json',feed)
  status={'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'metadata_source':metadata_source,'scanned':scanned,'entries':sum(counts.values()),'duplicates_skipped':duplicates,'systems':counts}
  atomic(STATE/'last-scan.json',status)
  (STATE/'refresh-errors.json').unlink(missing_ok=True)
  print(json.dumps(status))

if __name__=='__main__': main()
