// Bound completed-frame submissions awaiting the device GPU. The authoritative
// GX command ring retains unread work; no draws or frames are discarded.
export class GpuFrameQueue {
  constructor({limit=2, now=()=>performance.now(), onError=()=>{}}={}) {
    this.limit=limit;this.now=now;this.onError=onError;
    this.pending=new Set();this.completed=0;this.maximum=0;this.lastCompletionMs=0;
  }
  blocked(){return this.pending.size>=this.limit;}
  submitted(queue) {
    const token={started:this.now()};this.pending.add(token);
    this.maximum=Math.max(this.maximum,this.pending.size);
    let completion;
    try{completion=queue.onSubmittedWorkDone();}
    catch(error){this.pending.delete(token);this.onError(error);return;}
    Promise.resolve(completion).then(()=>{
      this.pending.delete(token);this.completed++;
      this.lastCompletionMs=Math.max(0,this.now()-token.started);
    },error=>{this.pending.delete(token);this.onError(error);});
  }
  snapshot(){return {limit:this.limit,pending:this.pending.size,maximum:this.maximum,completed:this.completed,lastCompletionMs:this.lastCompletionMs};}
}
