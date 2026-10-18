"""Independent final-Wasm store opcode/address sequence and typed-load audit.
Runs wasm-dis without optimization. Does not treat fewer loads as a speed claim.
"""
from pathlib import Path
import collections,hashlib,json,re,subprocess
root=Path('/fixture');folder=root/'modules'
def ast(text):
 tokens=re.findall(r'\(|\)|"(?:\\.|[^"\\])*"|[^\s()]+',re.sub(r';;[^\n]*','',text));stack=[];roots=[]
 for t in tokens:
  if t=='(':
   n=[]
   if stack:stack[-1].append(n)
   else:roots.append(n)
   stack.append(n)
  elif t==')':stack.pop()
  else:stack[-1].append(t)
 assert not stack and len(roots)==1
 return roots[0]
def visit(node):
 if not isinstance(node,list):return
 yield node
 for child in node:
  if isinstance(child,list):yield from visit(child)
def facts(node):
 stores=[];loads=collections.Counter();locals=0;tees=0
 for n in visit(node):
  if not n:continue
  op=n[0]
  if '.store' in op:
   address=next(c for c in n[1:] if isinstance(c,list))
   attrs=[c for c in n[1:] if isinstance(c,str)]
   stores.append([op,attrs,address])
  if '.load' in op:loads[op]+=1
  if op=='local':locals+=1
  if op=='local.tee':tees+=1
 return stores,dict(loads),locals,tees
def relative_loads(node):
 result=collections.Counter()
 for n in visit(node):
  if not n or '.load' not in n[0]:continue
  operands=[c for c in n[1:] if isinstance(c,list)]
  if not operands:continue
  address=operands[0]
  if len(address)==3 and address[0]=='i32.add':
   a,b=address[1:]
   if isinstance(a,list) and isinstance(b,list) and a==['local.get','$0'] and b[0]=='i32.const':result[n[0]+':'+b[1]]+=1
 return dict(result)
metadata={x['id']:x for x in json.loads((root/'module-metadata.json').read_text())}
records=[]
for b in sorted(folder.glob('*-baseline.wasm'),key=lambda p:int(p.name.split('-')[0])):
 pair={}
 for name in ['baseline','candidate']:
  f=folder/(b.name.split('-')[0]+'-'+name+'.wasm');wat=f.with_suffix('.wat')
  subprocess.run(['/emsdk/upstream/bin/wasm-dis',str(f),'-o',str(wat)],check=True,stdout=subprocess.DEVNULL)
  tree=ast(wat.read_text());pair[name]=facts(tree)
  pair[name+'RelativeLoads']=relative_loads(tree)
 assert pair['baseline'][0]==pair['candidate'][0],('ordered store opcode/address sequence',b.name)
 assert 0<=pair['candidate'][2]-pair['baseline'][2]<=8,('bounded cache locals',b.name,pair)
 assert sum(pair['candidate'][1].values())<=sum(pair['baseline'][1].values()),('load regression',b.name)
 records.append({'id':int(b.name.split('-')[0]),'orderedStores':len(pair['baseline'][0]),'storeAddressSequenceSha256':hashlib.sha256(json.dumps(pair['baseline'][0],sort_keys=True).encode()).hexdigest(),'baselineLoads':pair['baseline'][1],'candidateLoads':pair['candidate'][1],'extraLocals':pair['candidate'][2]-pair['baseline'][2],'captureTees':pair['candidate'][3]-pair['baseline'][3],'baselineRelativeLoads':pair['baselineRelativeLoads'],'candidateRelativeLoads':pair['candidateRelativeLoads']})
assert any(r['extraLocals'] for r in records)
boundaries=[];cap=[]
for record in records:
 meta=metadata[record['id']]
 if meta['mode']==13:
  key='i32.load:'+str(meta['src']);before=record['baselineRelativeLoads'].get(key,0);after=record['candidateRelativeLoads'].get(key,0)
  assert before==2 and after==(1 if meta['arg']==31 else 2),(meta,before,after)
  boundaries.append({'frontendArithmeticStatements':meta['arg'],'matchingReadDistance':meta['arg']+1,'baselineSourceLoads':before,'candidateSourceLoads':after})
 if meta['mode']==16:assert record['extraLocals']==8;cap.append(record['id'])
assert len(boundaries)==4 and len(cap)==1
result={'kernels':len(records),'orderedStoreSequencesEqual':True,'cacheLocalCap':8,'maxExtraLocals':max(r['extraLocals'] for r in records),'baselineLoads':sum(sum(r['baselineLoads'].values()) for r in records),'candidateLoads':sum(sum(r['candidateLoads'].values()) for r in records),'exactBoundaryAssertions':boundaries,'nineKeyCacheCapCases':cap,'records':records,'performanceClaim':False}
(root/'wat-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS actual final Wasm store sequences',result['kernels'],'max cache locals',result['maxExtraLocals'],'loads',result['baselineLoads'],'->',result['candidateLoads'])
