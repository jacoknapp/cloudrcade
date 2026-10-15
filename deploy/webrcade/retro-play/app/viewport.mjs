// Match the controller's visible-window intersection without moving its layout.
export function visibleViewport(scope=window){
 let left=0,top=0,right=scope.innerWidth,bottom=scope.innerHeight,view=scope,offsetX=0,offsetY=0;
 try{while(view){
  const candidate=view.visualViewport,visual=!candidate?.scale||Math.abs(candidate.scale-1)<.01?candidate:null;
  const x=visual?.offsetLeft||0,y=visual?.offsetTop||0;
  left=Math.max(left,x-offsetX);top=Math.max(top,y-offsetY);
  right=Math.min(right,view.innerWidth-offsetX,x+(visual?.width||view.innerWidth)-offsetX);
  bottom=Math.min(bottom,view.innerHeight-offsetY,y+(visual?.height||view.innerHeight)-offsetY);
  if(view===view.top||!view.frameElement)break;
  const frame=view.frameElement,rect=frame.getBoundingClientRect();offsetX+=rect.left+frame.clientLeft;offsetY+=rect.top+frame.clientTop;view=view.parent;
 }}catch{/* Cross-origin parents cannot supply additional visible bounds. */}
 return {left,top,right:Math.max(left+1,right),bottom:Math.max(top+1,bottom)};
}
export function pictureBounds({scope=window,safe,touch=false,controls=false}){
 const visible=visibleViewport(scope),left=Math.max(safe.left,visible.left),top=Math.max(safe.top,visible.top);
 const width=Math.max(1,Math.min(safe.right,visible.right)-left);
 let height=Math.max(1,Math.min(safe.bottom,visible.bottom)-top);
 if(touch&&controls&&height>width){
  const defaultPadHeight=scope.innerWidth<600?370:280,bottomInset=Math.max(0,scope.innerHeight-safe.bottom);
  height=Math.max(80,height-defaultPadHeight-Math.max(0,12-bottomInset)-20);
 }
 const w=Math.min(width,height*4/3),h=w*3/4;
 return {left:left+(width-w)/2,top:top+(height-h)/2,width:w,height:h};
}
