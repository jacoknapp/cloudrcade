"""Isolated PHP runtime configuration, denial and server-scoping tests (no network)."""
import json, os, shlex, subprocess
from pathlib import Path
ROOT = Path(__file__).parents[1] / 'deploy/webrcade/touch/cloud'
SOURCE = (ROOT/'settings.php').read_text().replace('<?php','',1).replace('declare(strict_types=1);','',1) + (ROOT/'api.php').read_text().replace('<?php','',1).replace('declare(strict_types=1);','',1).replace("require_once __DIR__ . '/settings.php';",'')
SETUP = r'''<?php namespace ConfigTest;
function getenv($name) {return $GLOBALS['env'][$name] ?? '';}
function session_start(){return true;}
function session_write_close(){return true;}
function session_regenerate_id($delete=false){return true;}
function curl_init($url){$GLOBALS['calls'][]=$url;return (object)['url'=>$url];}
function curl_setopt_array($ch,$args){$GLOBALS['agents'][]=$args[CURLOPT_USERAGENT];return true;}
function curl_setopt($ch,$key,$value){return true;}
function curl_close($ch){}
function curl_getinfo($ch,$key){return 200;}
function curl_exec($ch){$server=rtrim($GLOBALS['env']['NEXTCLOUD_URL'],'/');return json_encode(['login'=>$server.'/login/v2/flow/Fake','poll'=>['endpoint'=>$server.'/login/v2/poll','token'=>'fake']]);}
register_shutdown_function(function(){echo "\n".json_encode(['status'=>http_response_code(),'session'=>$_SESSION,'calls'=>$GLOBALS['calls'],'agents'=>$GLOBALS['agents'] ?? []]);});
'''
BASE={'NEXTCLOUD_URL':'https://cloud.example.com/subdir','WEBRCADE_PUBLIC_URL':'https://arcade.example.com','NEXTCLOUD_ENABLED':'true','NEXTCLOUD_AUTO_REDIRECT':'false'}
def run(env,action='status',headers=None,session=None):
 values={'env':env,'server':{'REQUEST_METHOD':'GET' if action=='status' else 'POST','HTTP_ORIGIN':'https://arcade.example.com','HTTP_X_CSRF_TOKEN':'test',**(headers or {})},'session':session or {'csrf':'test'},'get':{'action':action}}
 encoded=json.dumps(json.dumps(values))
 code=SETUP+f'$v=json_decode({encoded},true);$GLOBALS["env"]=$v["env"];$GLOBALS["calls"]=[];$_SERVER=$v["server"];$_SESSION=$v["session"];$_GET=$v["get"];\n'+SOURCE
 result=subprocess.run(shlex.split(os.getenv('WEBRCADE_PHP','php')),input=code,text=True,capture_output=True,check=True)
 lines=result.stdout.strip().splitlines();return json.loads(lines[0]),json.loads(lines[-1])
def main():
 body,state=run({});assert body['config']['enabled'] is False and not state['calls']
 body,state=run({'WEBRCADE_PUBLIC_URL':BASE['WEBRCADE_PUBLIC_URL']},'login');assert state['status']==403 and body['code']=='nextcloud_disabled' and not state['calls']
 for env in [{**BASE,'NEXTCLOUD_ENABLED':'false'},{**BASE,'NEXTCLOUD_URL':'http://unsafe.example.com'},{**BASE,'NEXTCLOUD_URL':'https://user:password@cloud.example.com'},{**BASE,'NEXTCLOUD_URL':'https://cloud.example.com/?extra=1'}]:
  body,_=run(env);assert body['config']['enabled'] is False
 body,state=run(BASE);assert body['config']['enabled'] is True and body['config']['autoRedirect'] is False
 assert body['config']['appName']=='cloudЯcade' and body['config']['storagePrefix']=='cloudrcade' and body['config']['saveFolder']=='CloudRcade'
 custom={**BASE,'WEBRCADE_APP_NAME':'My Arcade','WEBRCADE_STORAGE_PREFIX':'myarcade','NEXTCLOUD_SAVE_FOLDER':'Game Saves','WEBRCADE_FEED_URL':'https://catalog.example.com/feed.json','WEBRCADE_ENABLE_3DS':'true'}
 body,_=run(custom);assert body['config']['appName']=='My Arcade' and body['config']['storagePrefix']=='myarcade' and body['config']['saveFolder']=='Game Saves' and body['config']['feedUrl']==custom['WEBRCADE_FEED_URL'] and body['config']['enable3DS']
 body,_=run({**custom,'WEBRCADE_STORAGE_PREFIX':'../bad','NEXTCLOUD_SAVE_FOLDER':'..','WEBRCADE_FEED_URL':'//evil.invalid/feed.json'});assert body['config']['storagePrefix']=='cloudrcade' and body['config']['saveFolder']=='CloudRcade' and body['config']['feedUrl']=='/content/feeds/combined.json'
 body,state=run(BASE,'login');assert state['status']==200 and body['start'] is None and body['login'].startswith(BASE['NEXTCLOUD_URL']+'/')
 assert state['calls']==[BASE['NEXTCLOUD_URL']+'/index.php/login/v2']
 body,state=run({**BASE,'NEXTCLOUD_AUTO_REDIRECT':'true','NEXTCLOUD_HANDOFF':'true'},'login');assert body['start']==BASE['NEXTCLOUD_URL']+'/apps/retroarcade_login/start'
 guarded={**BASE,'NEXTCLOUD_ACCESS_HEADER':'X-Test-Groups','NEXTCLOUD_ACCESS_VALUE':'Cloud'}
 body,state=run(guarded,'login',{'HTTP_X_TEST_GROUPS':'Games|Other'});assert state['status']==403 and body['code']=='access_denied' and not state['calls']
 body,state=run(guarded,'login',{'HTTP_X_TEST_GROUPS':'Games|Cloud'});assert state['status']==200
 body,state=run(BASE,'verify',{'HTTP_X_NEXTCLOUD_AUTHORIZATION':'Basic ZmFrZTpmYWtl','HTTP_X_NEXTCLOUD_USER':'fake','HTTP_X_NEXTCLOUD_SERVER':'https://old.example.com'});assert state['status']==401 and not state['calls']
 body,state=run(BASE,'cancel',session={'csrf':'test','pending':{'token':'fake'}});assert state['status']==200 and 'pending' not in state['session']
 body,state=run({**BASE,'WEBRCADE_APP_NAME':'cloudЯcade','NEXTCLOUD_CLIENT_NAME':'Existing Arcade'},'login');assert state['agents']==['Existing Arcade cloud saves']
 body,state=run({**BASE,'WEBRCADE_APP_NAME':'Custom Arcade'},'login');assert state['agents']==['Custom Arcade cloud saves']
 print('PASS portable disabled defaults, strict env URL/booleans, independent auto flag/manual flow, optional handoff/access hint, denied access and cross-server credential protection')
if __name__=='__main__':main()
