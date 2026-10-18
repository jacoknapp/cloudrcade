// Raw host stage timing only. No payload, address, command or error data.
export class HandoffTrace {
 constructor(now=()=>performance.timeOrigin+performance.now()) {
  this.now=now;this.enabled=false;this.epoch=null;this.events=[];this.dropped=0;this.capacity=8192;this.failed=false;
 }
 setEnabled(enabled,epoch){this.enabled=!!enabled;this.epoch=epoch;}
 mark(stage,request,message,nativeEpoch,hostEpoch){
  if(!this.enabled||hostEpoch!==this.epoch)return;
  if(this.events.length===this.capacity){this.dropped=Math.min(Number.MAX_SAFE_INTEGER,this.dropped+1);return;}
  try{this.events.push({seq:this.events.length,ms:this.now(),stage,request,message,epoch:nativeEpoch,hostEpoch});}
  catch{this.failed=true;this.enabled=false;} // Diagnostics must never interrupt ACK publication.
 }
 snapshot(){return {clock:'performance.timeOrigin+performance.now',capacity:this.capacity,enabled:this.enabled,hostEpoch:this.epoch,dropped:this.dropped,failed:this.failed,events:this.events.map(row=>({...row}))};}
}
