import importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('lookup',ROOT/'deploy/webrcade/metadata_lookup.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LookupTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.state=Path(self.tmp.name)
  (self.state/'feeds').mkdir();self.item={'title':'Super Mario Sunshine (USA)','type':'gamecube','props':{'rom':'/content/GameCube/game.iso'}}
  (self.state/'feeds/combined.json').write_text(json.dumps({'categories':[{'items':[self.item]}]}))
  self.creds={'IGDBConfiguration':{'ClientId':'fixture-client','Secret':'fixture-secret'}}
 def lookup(self):
  with patch.dict(os.environ,{'WEBRCADE_METADATA_ENABLED':'true'}):return m.lookup(m.item_key(self.item),self.state,self.creds)
 def test_direct_igdb_cache_and_no_identity_changes(self):
  original=json.loads(json.dumps(self.item))
  with patch.object(m,'request_json',side_effect=[{'access_token':'fixture-token','expires_in':3600},[{'name':'Super Mario Sunshine','summary':'Fixture summary','cover':{'image_id':'fixture_cover'}}]]) as request:
   result=self.lookup();self.assertTrue(result['available']);self.assertIn('fixture_cover',result['metadata']['thumbnail']);self.assertEqual(request.call_count,2)
   self.assertEqual(self.lookup(),result);self.assertEqual(request.call_count,2)
  self.assertEqual(self.item,original);self.assertNotIn('Secret',json.dumps(result));self.assertNotIn('fixture-token',json.dumps(result))
 def test_imported_details_work_without_provider_or_catalog(self):
  self.item.update(description='Existing summary',thumbnail='https://images.igdb.com/fixture.jpg')
  (self.state/'feeds/combined.json').write_text(json.dumps({'categories':[{'items':[self.item]}]}))
  with patch.object(m,'request_json') as request:self.assertTrue(self.lookup()['available']);request.assert_not_called()
 def test_wrong_platform_name_and_failure_do_not_replace_metadata(self):
  self.assertIsNone(m.select_result('Super Mario Sunshine',[{'name':'Mario Kart Wii'}]))
  with patch.object(m,'request_json',side_effect=OSError('provider offline')):self.assertFalse(self.lookup()['available'])
 def test_disabled_unknown_and_uri_identity(self):
  with patch.dict(os.environ,{'WEBRCADE_METADATA_ENABLED':'false'}),patch.object(m,'request_json') as request:self.assertFalse(m.lookup(m.item_key(self.item),self.state,self.creds)['available']);request.assert_not_called()
  self.assertEqual(m.item_key(self.item),m.item_key({**self.item,'props':{'rom':'https://arcade.example.com/content/GameCube/game.iso'}}))
  with patch.dict(os.environ,{'WEBRCADE_METADATA_ENABLED':'true'}):self.assertFalse(m.lookup('0'*64,self.state,self.creds)['available'])
if __name__=='__main__':unittest.main()
