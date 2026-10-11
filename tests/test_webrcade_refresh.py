import importlib.util,json,tempfile,unittest,os,subprocess,sys
from pathlib import Path
from unittest.mock import patch
os.environ.update(WEBRCADE_ENABLE_3DS='true', WEBRCADE_REQUIRE_ROM_MOUNT='true', WEBRCADE_ENV_FILE='/nonexistent/cloudrcade-test.env', WEBRCADE_3DS_SKIP_DIRS='backups|cias', WEBRCADE_3DS_SKIP_NAMES='PKSM')
spec=importlib.util.spec_from_file_location('refresh',Path(__file__).parents[1]/'deploy/webrcade/refresh-feed.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RefreshTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name)/'roms';self.state=Path(self.tmp.name)/'state'
  (self.root/'snes/roms').mkdir(parents=True)
  self.patches=[patch.object(m,'ROOT',self.root),patch.object(m,'STATE',self.state),patch.object(m,'metadata',return_value=[]),patch.object(m.os.path,'ismount',return_value=True)]
  for p in self.patches:p.start();self.addCleanup(p.stop)
 def put(self,path,data):
  p=self.root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 def test_psp_scan_formats_and_bios_exclusion(self):
  for extension in ('iso','cso','pbp','elf'):
   self.put('psp/roms/Test.'+extension,extension.encode())
  self.put('psp/bios/Not a game.pbp',b'bios')
  self.put('psp/roms/Not a game.sav',b'save')
  self.put('nes/roms/game.nes',b'nes')
  m.main();feed=json.loads((self.state/'feeds/combined.json').read_text())
  category=next(c for c in feed['categories'] if c['title']=='PlayStation Portable')
  self.assertEqual(len(category['items']),4)
  self.assertTrue(all(i['type']=='psp' and '/psp/roms/' in i['props']['rom'] for i in category['items']))
 def test_portable_env_without_gaseous_or_a_mounted_snes_library(self):
  self.put('nes/roms/game.nes',b'portable-game')
  (self.root/'snes/roms').rmdir();(self.root/'snes').rmdir()
  env={**os.environ,'WEBRCADE_ENV_FILE':str(self.state/'absent.env'),'WEBRCADE_ROM_ROOT':str(self.root),'WEBRCADE_STATE_PATH':str(self.state),'WEBRCADE_FEED_TITLE':'My Arcade','WEBRCADE_CONTENT_URL':'https://arcade.example.com/catalog/','WEBRCADE_STORAGE_PREFIX':'myarcade','WEBRCADE_METADATA_ENABLED':'false','WEBRCADE_REQUIRE_ROM_MOUNT':'false','WEBRCADE_REQUIRED_ROM_DIR':''}
  subprocess.run([sys.executable,str(Path(m.__file__))],env=env,check=True,capture_output=True)
  feed=json.loads((self.state/'feeds/combined.json').read_text());self.assertEqual(feed['title'],'My Arcade')
  self.assertEqual(feed['categories'][0]['items'][0]['props']['rom'],'https://arcade.example.com/catalog/nes/roms/game.nes')
 def test_filters_deduplicates_and_routes_formats(self):
  self.put('nes/roms/mario.nes',b'game');self.put('nes/roms/duplicate.nes',b'game')
  self.put('nes/roms/hack.smc',b'snes');self.put('nes/bios/bios.nes',b'bios')
  self.put('nds/roms/game.nds',b'ds');self.put('nes/roms/save.sav',b'save')
  self.put('switch/Games/game.nsp',b'unsupported')
  m.main();f=json.load(open(self.state/'feeds/combined.json'))
  items=[i for c in f['categories'] for i in c['items']]
  self.assertEqual(len(items),3);self.assertEqual({i['type'] for i in items},{'nes','snes','retro-melonds'})
  before=(self.state/'feeds/combined.json').read_bytes()
  m.main();self.assertEqual(before,(self.state/'feeds/combined.json').read_bytes())
 def cia(self,title):
  tmd=0x2040;raw=bytearray(tmd+0x140+0x60)
  raw[0:20]=__import__('struct').pack('<IHHIII',0x2020,0,0,0,0,0x200)
  raw[tmd:tmd+4]=(0x10004).to_bytes(4,'big');raw[tmd+0x140+0x4C:tmd+0x140+0x54]=bytes.fromhex(title)
  return bytes(raw)
 def test_3ds_lists_only_bootable_games(self):
  self.put('snes/roms/game.sfc',b'game')
  self.put('3DS/Game Backup/Game.cia',self.cia('0004000000054000'))
  self.put('3DS/Game Backup/Game Update.cia',self.cia('0004000e00054000'))
  self.put('3DS/Game Backup/Game DLC.cia',self.cia('0004008c00054000'))
  self.put('3DS/Game Backup/Seeded.cia',self.cia('0004000000172800'))
  self.put('3DS/Game Backup/PKSM.cia',self.cia('000400000ec10000'))
  self.put('3DS/cias/FBI.cia',self.cia('000400000f800100'))
  self.put('3DS/Cart.3ds',bytes(0x100)+b'NCSD'+bytes(0x100))
  self.put('3DS/NotACart.3ds',bytes(0x300));self.put('3DS/backups/operator/boot9.bin',b'keys')
  m.main();f=json.load(open(self.state/'feeds/combined.json'))
  items=[c for c in f['categories'] if c['title']=='Nintendo 3DS'][0]['items']
  self.assertEqual(sorted(i['title'] for i in items),['Cart','Game'])
  self.assertEqual({i['type'] for i in items},{'3ds'})
  self.assertTrue(all(i['props']['rom'].startswith('/content/3DS/') for i in items))
  self.assertEqual(json.load(open(self.state/'last-scan.json'))['systems']['3DS'],2)
 def test_missing_share_preserves_previous_feed(self):
  self.put('snes/roms/game.sfc',b'game');m.main()
  before=(self.state/'feeds/combined.json').read_bytes()
  with patch.object(m.os.path,'ismount',return_value=False):
   with self.assertRaises(RuntimeError):m.main()
  self.assertEqual(before,(self.state/'feeds/combined.json').read_bytes())
 def test_metadata_outage_uses_cache(self):
  self.put('snes/roms/game.sfc',b'game');m.main()
  before=(self.state/'feeds/combined.json').read_bytes()
  with patch.object(m,'metadata',side_effect=RuntimeError('offline')):m.main()
  self.assertEqual(before,(self.state/'feeds/combined.json').read_bytes())
  self.assertEqual(json.load(open(self.state/'last-scan.json'))['metadata_source'],'cached')
 def test_bad_cue_preserves_previous_feed(self):
  self.put('snes/roms/game.sfc',b'game');m.main()
  before=(self.state/'feeds/combined.json').read_bytes()
  self.put('psx/bios/PSXONPSP660.BIN',b'bios')
  original=m.digest
  bios_hash=patch.object(m,'digest',side_effect=lambda p,c:'c53ca5908936d412331790f4426c6c33' if p.name=='PSXONPSP660.BIN' else original(p,c))
  bios_hash.start();self.addCleanup(bios_hash.stop)
  self.put('psx/roms/bad.cue',b'FILE "missing.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\n')
  with self.assertRaises(RuntimeError):m.main()
  self.assertEqual(before,(self.state/'feeds/combined.json').read_bytes())
  self.assertTrue((self.state/'refresh-errors.json').exists())
 def test_repairs_missing_track_type_without_changing_source(self):
  self.put('psx/roms/disc.bin',b'\x00'+b'\xff'*10+b'\x00'+b'\x00\x02\x00\x02'+bytes(2352-16))
  original=b'FILE "disc.bin" BINARY\n TRACK 01\n INDEX 01 00:00:00\n'
  self.put('psx/roms/disc.cue',original);(self.state/'derived').mkdir(parents=True)
  def convert(args,**kwargs):
   cue=Path(args[args.index('-i')+1]).read_text()
   self.assertIn('TRACK 01 MODE2/2352',cue)
   Path(args[args.index('-o')+1]).write_bytes(b'CHD')
   return type('Result',(),{'returncode':0})()
  with patch.object(m.subprocess,'run',side_effect=convert):m.cue_to_chd(self.root/'psx/roms/disc.cue',{})
  self.assertEqual(original,(self.root/'psx/roms/disc.cue').read_bytes())
 def test_cue_identity_includes_tracks_and_keeps_existing_save_ids(self):
  self.put('psx/bios/PSXONPSP660.BIN',b'bios')
  cue=b'FILE "track.bin" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\n'
  self.put('psx/roms/B/game.cue',cue);self.put('psx/roms/B/track.bin',b'original-game')
  original=m.digest
  def convert(args,**kwargs):
   Path(args[args.index('-o')+1]).write_bytes(b'CHD')
   return type('Result',(),{'returncode':0})()
  with patch.object(m,'digest',side_effect=lambda p,c:'c53ca5908936d412331790f4426c6c33' if p.name=='PSXONPSP660.BIN' else original(p,c)), patch.object(m.subprocess,'run',side_effect=convert):
   m.main()
   previous=json.loads((self.state/'feeds/combined.json').read_text())['categories'][0]['items'][0]['props']
   self.put('psx/roms/A/game.cue',cue);self.put('psx/roms/A/track.bin',b'different-game')
   self.put('psx/roms/C/game.cue',cue);self.put('psx/roms/C/track.bin',b'original-game')
   m.main()
   items=json.loads((self.state/'feeds/combined.json').read_text())['categories'][0]['items']
   self.assertEqual(len(items),2)
   self.assertEqual(len({i['props']['uid'] for i in items}),2)
   restored=next(i['props'] for i in items if i['props']['discs']==previous['discs'])
   self.assertEqual(restored['uid'],previous['uid'])
   before=(self.state/'feeds/combined.json').read_bytes();m.main()
   self.assertEqual((self.state/'feeds/combined.json').read_bytes(),before)
class MetadataConnectionTests(unittest.TestCase):
 def test_integrated_metadata_uses_direct_host_and_keeps_password_out_of_argv(self):
  with tempfile.TemporaryDirectory() as temp:
   config=Path(temp)/'metadata.json'
   config.write_text(json.dumps({'DatabaseConfiguration':{'UserName':'readonly','DatabaseName':'catalog','Password':'synthetic-only'}}))
   fake=type('Result',(),{'returncode':0,'stdout':'{"path":"example.nes"}\n'})()
   with patch.dict(os.environ,{'WEBRCADE_METADATA_ENABLED':'true','WEBRCADE_METADATA_CONFIG':str(config),'WEBRCADE_METADATA_DB_HOST':'db.example.test','WEBRCADE_METADATA_DB_PORT':'3307'}),patch.object(m.subprocess,'run',return_value=fake) as query:
    self.assertEqual(m.metadata(),[{'path':'example.nes'}])
    args=query.call_args.args[0];options=query.call_args.kwargs
    self.assertEqual(args[0],'mariadb');self.assertIn('--host=db.example.test',args);self.assertIn('--port=3307',args)
    self.assertNotIn('synthetic-only',' '.join(args));self.assertEqual(options['env']['MYSQL_PWD'],'synthetic-only')
 def test_socket_metadata_uses_local_transport_without_password_in_argv(self):
  with tempfile.TemporaryDirectory() as temp:
   config=Path(temp)/'metadata.json'
   config.write_text(json.dumps({'DatabaseConfiguration':{'UserName':'readonly','DatabaseName':'catalog','Password':'synthetic-only'}}))
   fake=type('Result',(),{'returncode':0,'stdout':'{"path":"example.nes"}\n'})()
   with patch.dict(os.environ,{'WEBRCADE_METADATA_ENABLED':'true','WEBRCADE_METADATA_CONFIG':str(config),'WEBRCADE_METADATA_DB_HOST':'ignored.example.test','WEBRCADE_METADATA_DB_SOCKET':'/run/catalog/mysqld.sock'}),patch.object(m.subprocess,'run',return_value=fake) as query:
    self.assertEqual(m.metadata(),[{'path':'example.nes'}])
    args=query.call_args.args[0];options=query.call_args.kwargs
    self.assertIn('--protocol=SOCKET',args);self.assertIn('--socket=/run/catalog/mysqld.sock',args)
    self.assertFalse(any(x.startswith('--host=') or x.startswith('--port=') for x in args))
    self.assertNotIn('synthetic-only',' '.join(args));self.assertEqual(options['env']['MYSQL_PWD'],'synthetic-only')
 def test_host_metadata_driver_also_keeps_password_out_of_argv(self):
  with tempfile.TemporaryDirectory() as temp:
   config=Path(temp)/'metadata.json'
   config.write_text(json.dumps({'DatabaseConfiguration':{'UserName':'readonly','DatabaseName':'catalog','Password':'synthetic-only'}}))
   fake=type('Result',(),{'returncode':0,'stdout':''})()
   with patch.dict(os.environ,{'WEBRCADE_METADATA_ENABLED':'true','WEBRCADE_METADATA_CONFIG':str(config),'WEBRCADE_METADATA_DB_HOST':'','WEBRCADE_METADATA_CONTAINER':'example-db'}),patch.object(m.subprocess,'run',return_value=fake) as query:
    self.assertEqual(m.metadata(),[])
    args=query.call_args.args[0];options=query.call_args.kwargs
    self.assertEqual(args[:5],['docker','exec','-i','-e','MYSQL_PWD'])
    self.assertNotIn('synthetic-only',' '.join(args));self.assertEqual(options['env']['MYSQL_PWD'],'synthetic-only')
if __name__=='__main__':unittest.main()
