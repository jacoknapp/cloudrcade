// Native Play! controller indices, independent of the other Sony cores.
export const BUTTONS={UP:4,DOWN:5,LEFT:6,RIGHT:7,SELECT:8,START:9,SQUARE:10,TRIANGLE:11,CIRCLE:12,CROSS:13,L1:14,L2:15,L3:16,R1:17,R2:18,R3:19};
export const KEYS={ArrowUp:'UP',ArrowDown:'DOWN',ArrowLeft:'LEFT',ArrowRight:'RIGHT',Backspace:'SELECT',Enter:'START',KeyA:'SQUARE',KeyS:'TRIANGLE',KeyX:'CIRCLE',KeyZ:'CROSS',Digit1:'L1',Digit2:'L2',Digit3:'L3',Digit8:'R1',Digit9:'R2',Digit0:'R3'};
export const TOUCH=[[0,'UP'],[1,'DOWN'],[2,'LEFT'],[3,'RIGHT'],[4,'CROSS'],[5,'CIRCLE'],[6,'SQUARE'],[7,'TRIANGLE'],[8,'L1'],[9,'R1'],[10,'L2'],[11,'R2'],[12,'SELECT'],[13,'START'],[16,'L3'],[17,'R3']];
const PAD=['CROSS','CIRCLE','SQUARE','TRIANGLE','L1','R1','L2','R2','SELECT','START','L3','R3','UP','DOWN','LEFT','RIGHT'];
const axis=value=>Math.round(128+127*Math.max(-1,Math.min(1,Number(value)||0)));
function squareStick(x,y){
 x=Math.max(-1,Math.min(1,Number(x)||0));y=Math.max(-1,Math.min(1,Number(y)||0));
 // Circular sticks must reach PS2's full independent axis range diagonally.
 // Preserve angle and continuous radial strength, including at the center;
 // existing square corners and cardinals already have the correct extent.
 const extent=Math.max(Math.abs(x),Math.abs(y));
 const scale=extent?Math.min(1,Math.hypot(x,y))/extent:0;
 return [x*scale,y*scale];
}
// Native state persists between polls; still poll devices each animation frame
// so releases, analog movement and disconnected controllers reach the VM.
export function inputWriter(write){
 const previous=[null,null];
 return (pad,state,force=false)=>{
  if(force||!previous[pad]||state.some((value,index)=>value!==previous[pad][index])){
   write(pad,...state);previous[pad]=state;
  }
 };
}
export function inputState(keys,pad,touch){
 let mask=0;for(const name of keys)if(BUTTONS[name]!==undefined)mask|=1<<BUTTONS[name];
 for(let index=0;index<PAD.length;index++)if(pad?.buttons[index]?.pressed)mask|=1<<BUTTONS[PAD[index]];
 for(const [cid,name]of TOUCH)if(touch?.isControlDown(cid))mask|=1<<BUTTONS[name];
 // Calibrate each source's stick before merging so simultaneous physical/touch
 // components cannot change one another's strength. Touch already has its own
 // radial center; add no physical or touch deadzone here.
 const touchAxes=[0,1].flatMap(index=>squareStick(touch?.getAxisValue(index,true),touch?.getAxisValue(index,false)));
 const padAxes=[0,1].flatMap(index=>squareStick(pad?.axes[index*2],pad?.axes[index*2+1]));
 const axes=touchAxes.map((value,index)=>value!==0?value:padAxes[index]);
 // Upstream browser keyboard analog assignments.
 for(const [index,negative,positive]of [[0,'KeyF','KeyH'],[1,'KeyT','KeyG'],[2,'KeyJ','KeyL'],[3,'KeyI','KeyK']])if(keys.has(negative)||keys.has(positive))axes[index]=(keys.has(positive)?1:0)-(keys.has(negative)?1:0);
 return [mask,...axes.map(axis)];
}
