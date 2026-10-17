#!/usr/bin/env python3
"""Generate GPU comparison vectors with the actual pinned Dolphin generic decoder.
Usage: generate.py /path/to/verified/wasm-dolphin /tmp/output.json
Builds one small host executable in a temporary directory, never modifies source.
"""
import base64, hashlib, json, pathlib, random, struct, subprocess, sys, tempfile
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2]); dolphin=root/'vendor/dolphin'
source=dolphin/'Source/Core/VideoCommon/TextureDecoder_Generic.cpp'
formats={0:(8,8,32,0),1:(8,4,32,0),2:(8,4,32,0),3:(4,4,32,0),4:(4,4,32,0),5:(4,4,32,0),6:(4,4,64,0),8:(8,8,32,32),9:(8,4,32,512),10:(4,4,32,32768),14:(8,8,32,0)}
vectors=[]
with tempfile.TemporaryDirectory(prefix='gc-texture-reference-') as work:
 exe=pathlib.Path(work)/'decode'
 subprocess.run(['g++','-std=c++23','-O2','-I'+str(dolphin/'Source/Core'),'-I'+str(dolphin/'Externals/fmt/fmt/include'),str(pathlib.Path(__file__).with_name('reference.cpp')),str(source),'-o',str(exe)],check=True)
 for fmt,(bw,bh,block,ps) in formats.items():
  for pf in (range(3) if ps else [0]):
   for w,h in [(1,1),(3,5),(8,8),(13,9),(32,16)]:
    aw=(w+bw-1)//bw*bw; ah=(h+bh-1)//bh*bh
    size=aw//bw*(ah//bh)*block
    for seed in [0,1]:
     rng=random.Random(0x60C0DE+fmt*10000+pf*1000+w*10+h+seed)
     data=bytes(rng.randrange(256) for _ in range(size)); palette=bytes(rng.randrange(256) for _ in range(ps))
     if fmt==14:
      # Every selector in both endpoint-order branches, equal endpoints, all four subblocks.
      blocks=[]
      for i in range(size//8):
       a,b=[(0xf800,0x001f),(0x001f,0xf800),(0x07e0,0x07e0),(0xffff,0)][(i+seed)%4]
       blocks.append(struct.pack('>HH',a,b)+bytes([0x1b,0xe4,0x55,0xaa]))
      data=b''.join(blocks)
     raw=subprocess.run([str(exe),str(fmt),str(aw),str(ah),str(pf),str(ps)],input=data+palette,stdout=subprocess.PIPE,check=True).stdout
     assert len(raw)==aw*ah*4
     pixels=b''.join(raw[y*aw*4:y*aw*4+w*4] for y in range(h))
     packet=struct.pack('<IIII',fmt,pf,len(data),len(palette))+data+palette
     vectors.append(dict(name=f'{fmt}-{pf}-{w}x{h}-{seed}',format=fmt,paletteFormat=pf,width=w,height=h,alignedWidth=aw,packet=base64.b64encode(packet).decode(),expected=base64.b64encode(pixels).decode()))
 out.write_text(json.dumps(dict(referenceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),vectors=vectors),separators=(',',':'))+'\n')
 print(f'Generated {len(vectors)} CPU reference vectors: {out}')
