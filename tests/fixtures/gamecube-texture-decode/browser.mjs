// Serve this file and the repository from the same HTTPS/localhost origin.
// runTextureDecodeTests(await fetch('/vectors.json').then(r=>r.json())) needs a
// real device WebGPU adapter. It returns exact pixel evidence, not game FPS.
import {encodeTextureDecode, textureDecodeWGSL} from '../../../deploy/webrcade/retro-dolphin/app/texture-decode.mjs';
const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function runTextureDecodeTests(fixture) {
  const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if (!adapter || adapter.info?.isFallbackAdapter || adapter.isFallbackAdapter) throw Error('Hardware adapter required');
  const device = await adapter.requestDevice();
  const errors=[];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  try {
    device.pushErrorScope('validation');
    const compilation = await device.createShaderModule({code:textureDecodeWGSL}).getCompilationInfo();
    const failures=compilation.messages.filter(x=>x.type==='error');
    if(failures.length) throw Error(JSON.stringify(failures.map(x=>({line:x.lineNum,message:x.message}))));
    let pixels=0, vectors=0, aliasCases=0, mipCases=0;
    for(let offset=0;offset<fixture.vectors.length;offset+=10) {
      const encoder=device.createCommandEncoder();
      const owned=[], readbacks=[];
      for(const v of fixture.vectors.slice(offset,offset+10)) {
        const mip=vectors%2;
        const texture=device.createTexture({size:[v.width<<mip,v.height<<mip],mipLevelCount:1+mip,format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
        owned.push(texture);
        const descriptor={tex:texture,format:'rgba8unorm',layers:1};
        const packet=bytes(v.packet);
        const result=encodeTextureDecode(device,encoder,descriptor,packet,v.width,v.height,v.alignedWidth,mip);
        owned.push(...result.buffers);
        // Recycle the source/palette immediately after synchronous input capture.
        packet.fill(0xa5);
        const row=Math.ceil(v.width*4/256)*256;
        const readback=device.createBuffer({size:row*v.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        owned.push(readback);
        encoder.copyTextureToBuffer({texture,mipLevel:mip},{buffer:readback,bytesPerRow:row},{width:v.width,height:v.height});
        readbacks.push({buffer:readback,row,v,kind:'decoded'});
        // GPU texture alias/copy snapshots survive overwrite of the original texture.
        const alias=device.createTexture({size:[v.width,v.height],format:'rgba8unorm',usage:GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
        owned.push(alias);
        encoder.copyTextureToTexture({texture,mipLevel:mip},{texture:alias},{width:v.width,height:v.height});
        const overwrite=bytes(v.packet); overwrite.fill(0,16);
        owned.push(...encodeTextureDecode(device,encoder,descriptor,overwrite,v.width,v.height,v.alignedWidth,mip).buffers);
        const aliasReadback=device.createBuffer({size:row*v.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        owned.push(aliasReadback);
        encoder.copyTextureToBuffer({texture:alias},{buffer:aliasReadback,bytesPerRow:row},{width:v.width,height:v.height});
        readbacks.push({buffer:aliasReadback,row,v,kind:'alias'});
        vectors++; aliasCases++; mipCases+=mip; pixels+=v.width*v.height;
      }
      device.queue.submit([encoder.finish()]);
      // Destroy immutable inputs only after submission, while readbacks remain owned.
      const reads=new Set(readbacks.map(x=>x.buffer));
      for(const object of owned) if(!reads.has(object)) object.destroy();
      await Promise.all(readbacks.map(async ({buffer,row,v,kind})=>{
        await buffer.mapAsync(GPUMapMode.READ);
        const actual=new Uint8Array(buffer.getMappedRange()), expected=bytes(v.expected);
        for(let y=0;y<v.height;y++) for(let x=0;x<v.width*4;x++) {
          if(actual[y*row+x]!==expected[y*v.width*4+x]) throw Error(`${v.name} ${kind} byte ${y*v.width*4+x}: ${actual[y*row+x]} != ${expected[y*v.width*4+x]}`);
        }
        buffer.unmap();buffer.destroy();
      }));
    }
    await device.queue.onSubmittedWorkDone();
    const error=await device.popErrorScope(); if(error) errors.push(error.message);
    if(errors.length) throw Error(errors.join('\n'));
    return {passed:true,vectors,pixels,aliasCases,mipCases,referenceSha256:fixture.referenceSha256,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false},validationErrors:errors};
  } finally { device.destroy(); }
}
