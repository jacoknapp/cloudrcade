"""Server-only IGDB metadata lookup, requested by opaque library item key."""
import difflib, fcntl, hashlib, json, os, re, tempfile, time, unicodedata
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode, urlsplit

PLATFORMS={'nes':18,'snes':19,'gb':33,'gbc':22,'gba':24,'n64':4,'retro-melonds':20,'genesis':29,'psx':7,'psp':38,'ps2':8,'3ds':37,'gamecube':21}

def normalized_identity(value):
 if isinstance(value,list):return [normalized_identity(v) for v in value]
 if isinstance(value,str) and value.startswith(('https://','http://')):
  uri=urlsplit(value);return uri.path+('?' + uri.query if uri.query else '')
 return value

def item_key(item):
 p=item.get('props',{}); identity=p.get('uid') or p.get('rom') or p.get('discs')
 return hashlib.sha256(json.dumps([item.get('type'),normalized_identity(identity)],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def cached_item(item, directory):
 try:
  entry=json.loads((Path(directory)/(item_key(item)+'.json')).read_text())
  metadata={k:v for k,v in entry.get('metadata',{}).items() if k in ['longTitle','description','thumbnail'] and isinstance(v,str)}
  return dict(metadata,_cloudrcadeMetadataSource='igdb') if metadata else {}
 except (OSError,ValueError):return {}

def atomic(path,value):
 path=Path(path)
 with tempfile.NamedTemporaryFile('w',dir=path.parent,delete=False) as f:
  json.dump(value,f,separators=(',',':'));f.flush();os.fsync(f.fileno());name=f.name
 os.chmod(name,0o600);os.replace(name,path)

def normalize(name):
 name=re.sub(r'\([^)]*\)|\[[^]]*\]','',name)
 return ''.join(c for c in unicodedata.normalize('NFKD',name).casefold() if c.isalnum())

def select_result(title, results):
 expected=normalize(title)
 scored=[(difflib.SequenceMatcher(None,expected,normalize(r.get('name',''))).ratio(),r) for r in results if r.get('name')]
 if not scored:return None
 score,result=max(scored,key=lambda pair:pair[0])
 return result if score>=.88 else None

def request_json(url,data,headers=None):
 req=Request(url,data=data,headers=headers or {},method='POST')
 with urlopen(req,timeout=3) as response:return json.load(response)

def lookup(key, state=None, credentials=None):
 if os.environ.get('WEBRCADE_METADATA_ENABLED','false').lower() not in ('true','1','yes','on'):return {'available':False}
 if not re.fullmatch('[0-9a-f]{64}',key):return {'available':False}
 state=Path(state or os.environ.get('WEBRCADE_STATE_PATH','/data'))
 feed=json.loads((state/'feeds/combined.json').read_text())
 item=next((i for c in feed.get('categories',[]) for i in c.get('items',[]) if item_key(i)==key),None)
 if not item or item.get('type') not in PLATFORMS:return {'available':False}
 directory=state/'metadata';cached=directory/(key+'.json');now=time.time()
 try:entry=json.loads(cached.read_text())
 except (OSError,ValueError):entry={}
 # Own cache files also identify provider fields published by older scanners.
 # Keep genuinely imported details, but never promote provider data past its TTL.
 if item.get('description') and item.get('thumbnail') and item.get('_cloudrcadeMetadataSource')!='igdb' and not cached.exists():
  return {'available':True,'metadata':{k:item[k] for k in ['longTitle','description','thumbnail'] if k in item}}
 if entry.get('expires',0)>now:return {'available':bool(entry.get('metadata')),'metadata':entry.get('metadata',{})}
 directory.mkdir(parents=True,exist_ok=True)
 with (directory/'.requests.lock').open('a+') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return {'available':False,'pending':True}
  token_path=directory/'.token.json'
  try:token=json.loads(token_path.read_text())
  except (OSError,ValueError):token={}
  if token.get('next_request',0)>now:return {'available':False,'pending':True,'retryAfterMs':min(300000,max(1200,int((token['next_request']-now)*1000)+1))}
  cfg=credentials or json.loads(Path(os.environ.get('WEBRCADE_METADATA_CONFIG','/config/metadata.json')).read_text())
  cfg=cfg.get('IGDBConfiguration',cfg)
  if not cfg.get('ClientId') or not cfg.get('Secret'):return {'available':False}
  # Serialize across browser profiles and cache the app token privately.
  token['next_request']=now+1
  atomic(token_path,token)
  try:
   if token.get('expires',0)<now+60:
    value=request_json('https://id.twitch.tv/oauth2/token',urlencode({'client_id':cfg['ClientId'],'client_secret':cfg['Secret'],'grant_type':'client_credentials'}).encode(),{'Content-Type':'application/x-www-form-urlencoded'})
    token.update(access_token=value['access_token'],expires=now+int(value['expires_in']))
    atomic(token_path,token)
   title=item.get('title','')[:200]
   search=re.sub(r'\([^)]*\)|\[[^]]*\]','',title).replace('_',' ').strip()
   query='fields name,summary,cover.image_id; search '+json.dumps(search)+'; where platforms = ('+str(PLATFORMS[item['type']])+'); limit 10;'
   results=request_json('https://api.igdb.com/v4/games',query.encode(),{'Client-ID':cfg['ClientId'],'Authorization':'Bearer '+token['access_token'],'Content-Type':'text/plain'})
   result=select_result(title,results);metadata={}
   if result:
    metadata['longTitle']=result['name']+' — '+title
    if result.get('summary'):metadata['description']=result['summary'][:10000]
    image=result.get('cover',{}).get('image_id','')
    if re.fullmatch('[a-zA-Z0-9_-]+',image):metadata['thumbnail']='https://images.igdb.com/igdb/image/upload/t_cover_big/'+image+'.jpg'
   atomic(cached,{'metadata':metadata,'expires':now+(30*86400 if metadata else 86400)})
   return {'available':bool(metadata),'metadata':metadata}
  except Exception:
   # Provider outages never block play or discard previously cached metadata.
   token['next_request']=now+300
   token.pop('access_token',None);token.pop('expires',None);atomic(token_path,token)
   return {'available':bool(entry.get('metadata')),'metadata':entry.get('metadata',{}),'pending':True,'retryAfterMs':300000}

if __name__=='__main__':
 import sys
 try:result=lookup(sys.argv[1])
 except Exception:result={'available':False}
 print(json.dumps(result,separators=(',',':')))
