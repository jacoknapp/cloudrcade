// Bound completed-frame submissions awaiting the device GPU. The authoritative
// GX command ring retains unread work; no draws or frames are discarded.
export class GpuFrameQueue {
  constructor({limit=2, now=()=>performance.now(), onError=()=>{}}={}) {
    this.limit=limit;this.now=now;this.onError=onError;
    this.pending=new Set();this.completed=0;this.maximum=0;this.lastCompletionMs=0;
    this.generation=0;this.capacityWaiter=null;
  }
  blocked(){return this.pending.size>=this.limit;}
  // Only the replay pump that actually observed GPU backpressure may arm this.
  // One successful completion consumes the waiter; small producer writes do not
  // create notifications. Recheck capacity to avoid a check/subscribe lost wake.
  waitForCapacity(callback) {
    if (!this.blocked()) {this.cancelWait();callback();return;}
    this.capacityWaiter=callback;
  }
  cancelWait(){this.capacityWaiter=null;}
  reset(){this.generation++;this.cancelWait();this.pending.clear();}
  submitted(queue) {
    const token={started:this.now(),generation:this.generation};this.pending.add(token);
    this.maximum=Math.max(this.maximum,this.pending.size);
    let completion;
    try{completion=queue.onSubmittedWorkDone();}
    catch(error){this.pending.delete(token);this.cancelWait();this.onError(error);return;}
    Promise.resolve(completion).then(()=>{
      if(token.generation!==this.generation)return;
      this.pending.delete(token);this.completed++;
      this.lastCompletionMs=Math.max(0,this.now()-token.started);
      if(!this.blocked()&&this.capacityWaiter){
        const callback=this.capacityWaiter;this.cancelWait();callback();
      }
    },error=>{
      if(token.generation!==this.generation)return;
      this.pending.delete(token);this.cancelWait();this.onError(error);
    });
  }
  snapshot(){return {limit:this.limit,pending:this.pending.size,maximum:this.maximum,completed:this.completed,lastCompletionMs:this.lastCompletionMs};}
}
