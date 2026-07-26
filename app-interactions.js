el.viewport.addEventListener('pointerdown',(event)=>{
  el.viewport.setPointerCapture(event.pointerId);state.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(state.pointers.size===2){beginGesture();return;}if(state.pointers.size>1)return;
  const p=point(event.clientX,event.clientY);state.lastClient={x:event.clientX,y:event.clientY};state.lastPoint=p;state.dragStart=p;state.layerTapMoved=false;
  if(state.tool==='hand'){state.drawing=true;return;}
  if(!inImage(p)&&(state.tool==='layer'||state.tool==='pick'||state.tool==='stretch')){say('사진 안쪽에서 시작하세요');return;}
  if(state.tool==='layer'){if(state.segmentationBusy)return;state.drawing=true;drawOverlay();return;}
  if(state.tool==='pick'){state.line=[p,p];state.autoSource=false;state.drawing=true;drawOverlay();return;}
  if(state.tool==='stretch'){
    if(!activeLayer()){say('먼저 기준 레이어를 선택하세요');setTool('layer');return;}
    if(!prepareEdgeSource(p)){say('선택 요소의 경계를 찾지 못했습니다 · 경계 가까이에서 시작하세요');return;}
    snapshot();state.preview=fx.getImageData(0,0,el.effect.width,el.effect.height);state.drawing=true;renderStretch(p);return;
  }
  if(state.tool==='spray'){
    if(!state.strip&&activeLayer())prepareEdgeSource(p);
    if(!state.strip){say('먼저 기준선을 선택하세요');return;}
    snapshot();state.preview=fx.getImageData(0,0,el.effect.width,el.effect.height);state.drawing=true;stamp(p,0);
  }
});

el.viewport.addEventListener('pointermove',(event)=>{
  if(state.pointers.has(event.pointerId))state.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(state.pointers.size>=2){updateGesture();return;}if(!state.drawing)return;
  if(state.tool==='hand'){state.tx+=event.clientX-state.lastClient.x;state.ty+=event.clientY-state.lastClient.y;state.lastClient={x:event.clientX,y:event.clientY};applyTransform();return;}
  const p=point(event.clientX,event.clientY);
  if(state.tool==='layer'){state.lastPoint=p;if(state.dragStart&&Math.hypot(p.x-state.dragStart.x,p.y-state.dragStart.y)>Math.max(5,10/state.scale))state.layerTapMoved=true;drawOverlay();}
  else if(state.tool==='pick'){state.line[1]=clampToImage(p);drawOverlay();}
  else if(state.tool==='spray'){spraySegment(state.lastPoint,p);state.lastPoint=p;}
  else if(state.tool==='stretch')renderStretch(p);
});

function endPointer(event,cancelled=false){
  state.pointers.delete(event.pointerId);if(state.pointers.size<2)state.gesture=null;if(!state.drawing)return;
  if(state.tool==='layer'){
    const target=state.lastPoint,shouldSelect=!cancelled&&!state.layerTapMoved&&target&&inImage(target);state.drawing=false;state.lastPoint=null;state.dragStart=null;drawOverlay();if(shouldSelect)void selectLayerAt(target);return;
  }
  if(state.tool==='pick'){
    if(cancelled)state.line=[];else{const m=metrics(state.line[0],state.line[1]);if(m.d<8){state.line=[];say('기준선을 조금 더 길게 그어주세요');}else{state.strip=makeStrip();state.autoSource=false;state.stretchStart={x:(state.line[0].x+state.line[1].x)/2,y:(state.line[0].y+state.line[1].y)/2};setTool('stretch');say('기준선에서 원하는 방향으로 당겨주세요');}}
    state.drawing=false;state.lastPoint=null;state.dragStart=null;drawOverlay();return;
  }
  if(state.tool==='spray'||state.tool==='stretch'){
    if(cancelled&&state.preview){fx.putImageData(state.preview,0,0);state.undo.pop();updateHistory();}else say(state.tool==='stretch'?'픽셀 스트레치를 적용했습니다':'픽셀을 뿌렸습니다');
  }
  state.drawing=false;state.preview=null;state.lastPoint=null;state.dragStart=null;state.stretchStart=null;updateHistory();drawOverlay();
}
el.viewport.addEventListener('pointerup',(e)=>endPointer(e,false));el.viewport.addEventListener('pointercancel',(e)=>endPointer(e,true));

el.viewport.addEventListener('wheel',(event)=>{event.preventDefault();const r=el.viewport.getBoundingClientRect(),mx=event.clientX-r.left,my=event.clientY-r.top,ixp=(mx-state.tx)/state.scale,iyp=(my-state.ty)/state.scale;state.scale=Math.max(.05,Math.min(7,state.scale*Math.exp(-event.deltaY*.001)));state.tx=mx-ixp*state.scale;state.ty=my-iyp*state.scale;applyTransform();drawOverlay();},{passive:false});

async function save(){if(!state.imageRect)return;const output=document.createElement('canvas');output.width=el.effect.width;output.height=el.effect.height;const c=output.getContext('2d');c.drawImage(el.image,0,0);c.drawImage(el.effect,0,0);c.drawImage(el.foreground,0,0);const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png',1));if(!blob)return;const file=new File([blob],`${state.fileName}-pixel-stretch-${Date.now()}.png`,{type:'image/png'});try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Pixel Stretch'});return;}}catch(error){if(error.name==='AbortError')return;}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);}
el.save.addEventListener('click',save);window.addEventListener('beforeunload',()=>state.segmenter?.close?.());if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));