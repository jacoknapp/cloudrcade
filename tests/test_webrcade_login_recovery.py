"""Run with PHP CLI (WEBRCADE_PHP may select the deployed container's interpreter).
Only session/cURL IO doubles run; no account, network, or real session is touched.
"""
import json, os, shlex, subprocess, time
from pathlib import Path
ROOT = Path(__file__).parents[1] / 'deploy/webrcade/touch/cloud'
SOURCE = (ROOT / 'settings.php').read_text().replace('<?php', '', 1).replace('declare(strict_types=1);', '', 1) + (ROOT / 'api.php').read_text().replace('<?php', '', 1).replace('declare(strict_types=1);', '', 1).replace("require_once __DIR__ . '/settings.php';", '')
SETUP = r'''<?php declare(strict_types=1); namespace Review;
function getenv($name) { return ['NEXTCLOUD_SAVE_FOLDER'=>'CloudRcade','WEBRCADE_APP_NAME'=>'CloudRcade','WEBRCADE_STORAGE_PREFIX'=>'wrcad','NEXTCLOUD_ENABLED'=>'true','NEXTCLOUD_URL'=>'https://cloud.example.test','WEBRCADE_PUBLIC_URL'=>'https://arcade.example.test','NEXTCLOUD_HANDOFF'=>'true','NEXTCLOUD_LEGACY_URL'=>'https://cloud.example.test'][$name] ?? ''; }
function session_start() { return true; }
function session_regenerate_id($delete = false) { return true; }
function session_write_close() { return true; }
function curl_init($url) { return (object)['url'=>$url]; }
function curl_setopt_array($ch,$args) { return true; }
function curl_setopt($ch,$key,$value) { return true; }
function curl_close($ch) {}
function curl_getinfo($ch,$key) { return $ch->code; }
function curl_exec($ch) {
 if (str_ends_with($ch->url,'/login/v2/poll')) {
  if ($GLOBALS['mode']!=='first') throw new \RuntimeException('Polled consumed token twice');
  $ch->code=200;return json_encode(['server'=>'https://cloud.example.test','loginName'=>'fake','appPassword'=>'fake-token']);
 }
 if (str_contains($ch->url,'/ocs/v2.php/cloud/user')) {
  if ($GLOBALS['mode']==='first') {$ch->code=503;return '{}';}
  $ch->code=200;return json_encode(['ocs'=>['data'=>['id'=>'fake-uid']]]);
 }
 if (str_contains($ch->url,'/remote.php/dav/files/')) {$ch->code=201;return '';}
 throw new \RuntimeException('Unexpected upstream: '.$ch->url);
}
register_shutdown_function(function(){echo "\n".json_encode(['status'=>http_response_code(),'session'=>$_SESSION]);});
'''
def run(action, mode, session, receipt=''):
    server={'REQUEST_METHOD':'POST','HTTP_ORIGIN':'https://arcade.example.test','HTTP_X_CSRF_TOKEN':'test','HTTP_X_LOGIN_RECEIPT':receipt}
    values={'session':session,'server':server,'get':{'action':action},'mode':mode}
    encoded=json.dumps(json.dumps(values))
    code=SETUP+f'$v=json_decode({encoded},true);$_SERVER=$v["server"];$_SESSION=$v["session"];$_GET=$v["get"];$GLOBALS["mode"]=$v["mode"];\n'+SOURCE
    proc=subprocess.run(shlex.split(os.environ.get('WEBRCADE_PHP','php')),input=code,text=True,capture_output=True,check=True)
    lines=proc.stdout.strip().splitlines()
    return json.loads(lines[0]),json.loads(lines[-1])
def main():
    session={'csrf':'test','pending':{'login':'https://cloud.example.test/login/v2/flow/TEST','endpoint':'/login/v2/poll','token':'fake','expires':int(time.time())+1200}}
    body,state=run('poll','first',session);assert state['status']==502
    session=state['session'];assert session['pending']['credential']['password']=='fake-token'
    body,state=run('login','retry',session);assert body=={'ready':True}
    body,state=run('poll','retry',session);assert body['connected'] and body['connection']['uid']=='fake-uid'
    receipt=body['receipt'];session=state['session']
    # A lost response can be fetched again without polling the consumed NC token.
    repeated,state=run('poll','retry',session);assert repeated==body
    _,state=run('ack','retry',session,'wrong');assert state['status']==409 and 'pending' in state['session']
    _,state=run('ack','retry',session,receipt);assert state['status']==200 and 'pending' not in state['session']
    print('PASS one-shot poll recovery after OCS failure, retry-ready Link, lost-response retry, receipt validation and credential cleanup')
if __name__=='__main__': main()
