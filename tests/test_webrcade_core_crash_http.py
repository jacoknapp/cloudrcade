"""Bounded same-origin app crash-log endpoint; run against an owned stage/live app.
Only synthetic verification reports are sent; no saves or accounts are touched.
"""
import json, os, ssl, urllib.request, urllib.error
origin=os.environ['WEBRCADE_CRASH_ORIGIN'].rstrip('/')
context=ssl._create_unverified_context()
url=origin+'/cloud-saves/core-crash-log.php'
def send(value,expected,headers=None,method='POST'):
    body=json.dumps(value).encode() if not isinstance(value,bytes) else value
    request=urllib.request.Request(url,data=body if method=='POST' else None,method=method,
        headers={'Origin':origin,'Content-Type':'application/json',**(headers or {})})
    try: response=urllib.request.urlopen(request,context=context,timeout=10)
    except urllib.error.HTTPError as error: response=error
    assert response.status==expected,(response.status,expected)
    assert response.headers['Cache-Control']=='no-store'
    assert response.headers['Cross-Origin-Resource-Policy']=='same-origin'
    assert response.read()==b''
base={'version':1,'id':'shadowcrash-http-verification','system':'retro-ppsspp','phase':'failed','reason':'verification',
      'sample':{'frame':12,'heapMiB':64,'unexpected':'private-should-never-be-logged'},'url':'private-should-never-be-logged'}
send(base,204)
send(base,405,method='GET')
send(base,403,{'Origin':'https://unrelated.invalid'})
send(base,403,{'Origin':origin+'/path'})
send(base,415,{'Content-Type':'text/plain'})
send(b' '*4097,413)
send(b'invalid JSON',400)
for change in [{'version':2},{'id':'bad\nlog-line'},{'system':'../rom-url'},{'reason':'private error string'},{'phase':'arbitrary'}]:
    send({**base,**change},400)
print('PASS shared crash-log HTTP validation, same-origin denial, bounded body/schema; synthetic report id='+base['id'])
