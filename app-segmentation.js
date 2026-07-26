async function ensureSegmenter() {
  if (state.segmenter) return state.segmenter;
  if (state.segmenterPromise) return state.segmenterPromise;
  state.segmenterPromise = (async () => {
    const visionTasks = await import(MEDIAPIPE_MODULE);
    const vision = await visionTasks.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    state.modelCanvas.width = 1; state.modelCanvas.height = 1;
    const make = (delegate, canvas) => visionTasks.InteractiveSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: SEGMENT_MODEL, delegate }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false, ...(canvas ? { canvas } : {}) });
    try { return await make('GPU', state.modelCanvas); } catch (error) { console.warn('GPU segmentation fallback', error); return make('CPU'); }
  })();
  try { state.segmenter = await state.segmenterPromise; return state.segmenter; } finally { state.segmenterPromise = null; }
}

function maskCanvasFromCategory(categoryMask, tap) {
  const w=categoryMask.width,h=categoryMask.height,data=categoryMask.getAsUint8Array(),x=Math.max(0,Math.min(w-1,Math.round(tap.x*(w-1)))),y=Math.max(0,Math.min(h-1,Math.round(tap.y*(h-1))));
  const normal=data[y*w+x], flipped=data[(h-1-y)*w+x]; let flipY=false,target=0;
  if(normal!==0&&flipped===0)flipY=true; else if(normal!==0)target=normal;
  const pixels=new Uint8ClampedArray(w*h*4);let selected=0;
  for(let row=0;row<h;row++){const srcRow=flipY?h-1-row:row;for(let col=0;col<w;col++){if(data[srcRow*w+col]!==target)continue;const i=(row*w+col)*4;pixels[i]=pixels[i+1]=pixels[i+2]=pixels[i+3]=255;selected++;}}
  const low=document.createElement('canvas');low.width=w;low.height=h;low.getContext('2d').putImageData(new ImageData(pixels,w,h),0,0);
  const full=document.createElement('canvas');full.width=state.sourceCanvas.width;full.height=state.sourceCanvas.height;const c=full.getContext('2d');c.imageSmoothingEnabled=true;c.drawImage(low,0,0,full.width,full.height);
  return {maskCanvas:full,ratio:selected/Math.max(1,w*h)};
}

async function segmentWithAI(canvasPoint) {
  const segmenter=await ensureSegmenter(),r=state.imageRect,normalized={x:Math.max(0,Math.min(1,(canvasPoint.x-r.x)/r.w)),y:Math.max(0,Math.min(1,(canvasPoint.y-r.y)/r.h))};
  const result=segmenter.segment(state.sourceCanvas,{keypoint:normalized});if(!result.categoryMask)throw new Error('no mask');
  try{return maskCanvasFromCategory(result.categoryMask,normalized);}finally{result.categoryMask.close();}
}

function fallbackSmartMask(canvasPoint) {
  const sw=state.sourceCanvas.width,sh=state.sourceCanvas.height,max=360,scale=Math.min(1,max/Math.max(sw,sh)),w=Math.max(16,Math.round(sw*scale)),h=Math.max(16,Math.round(sh*scale));
  const low=document.createElement('canvas');low.width=w;low.height=h;const c=low.getContext('2d',{willReadFrequently:true});c.drawImage(state.sourceCanvas,0,0,w,h);const image=c.getImageData(0,0,w,h),data=image.data,r=state.imageRect,sx=Math.max(0,Math.min(w-1,Math.round(((canvasPoint.x-r.x)/r.w)*(w-1)))),sy=Math.max(0,Math.min(h-1,Math.round(((canvasPoint.y-r.y)/r.h)*(h-1)))),si=(sy*w+sx)*4,seed=[data[si],data[si+1],data[si+2]],seen=new Uint8Array(w*h),sel=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0,count=0;queue[tail++]=sy*w+sx;seen[sy*w+sx]=1;
  const distance=(i)=>{const dr=data[i]-seed[0],dg=data[i+1]-seed[1],db=data[i+2]-seed[2];return Math.sqrt(dr*dr*.3+dg*dg*.52+db*db*.18);};
  while(head<tail&&count<w*h*.65){const p=queue[head++],i=p*4;if(distance(i)>58)continue;sel[p]=1;count++;const x=p%w,y=Math.floor(p/w),push=n=>{if(!seen[n]){seen[n]=1;queue[tail++]=n;}};if(x)push(p-1);if(x<w-1)push(p+1);if(y)push(p-w);if(y<h-1)push(p+w);}
  const out=new Uint8ClampedArray(w*h*4);for(let i=0;i<sel.length;i++)if(sel[i])out[i*4]=out[i*4+1]=out[i*4+2]=out[i*4+3]=255;
  const maskLow=document.createElement('canvas');maskLow.width=w;maskLow.height=h;maskLow.getContext('2d').putImageData(new ImageData(out,w,h),0,0);const full=document.createElement('canvas');full.width=sw;full.height=sh;full.getContext('2d').drawImage(maskLow,0,0,sw,sh);return{maskCanvas:full,ratio:count/Math.max(1,w*h)};
}

function addLayer(maskCanvas,engine){if(state.layers.length>=MAX_LAYERS){say(`레이어는 최대 ${MAX_LAYERS}개입니다`);return null;}state.layerSequence++;const layer={id:`layer-${Date.now()}-${state.layerSequence}`,name:`요소 ${state.layerSequence}`,maskCanvas,previewCanvas:makeMaskPreview(maskCanvas),engine,effectPlacement:'behind'};state.layers.push(layer);state.activeLayerId=layer.id;scheduleForegroundRender();updateLayerUI();return layer;}
function combineMask(layer,incoming,operation){const c=layer.maskCanvas.getContext('2d');c.save();c.globalCompositeOperation=operation==='add'?'source-over':'destination-out';c.drawImage(incoming,0,0,layer.maskCanvas.width,layer.maskCanvas.height);c.restore();layer.previewCanvas=makeMaskPreview(layer.maskCanvas);scheduleForegroundRender();updateLayerUI();drawOverlay();}

async function selectLayerAt(canvasPoint){
  if(state.segmentationBusy||!inImage(canvasPoint))return;const token=state.imageToken;state.segmentationBusy=true;updateHint();setAIStatus(true,state.refineMode==='add'?'영역 추가 중':state.refineMode==='remove'?'영역 제거 중':'요소 분석 중','탭한 위치의 실제 경계를 계산합니다');
  let result,engine='AI';try{result=await segmentWithAI(canvasPoint);if(token!==state.imageToken)return;if(result.ratio<.001||result.ratio>.94)throw new Error('bad mask');}catch(error){console.warn(error);result=fallbackSmartMask(canvasPoint);engine='간편';if(result.ratio<.001||result.ratio>.72){say('경계를 찾지 못했습니다 · 요소 안쪽을 다시 탭하세요');return;}}finally{if(token===state.imageToken){state.segmentationBusy=false;setAIStatus(false);updateHint();}}
  if(!result||token!==state.imageToken)return;
  const active=activeLayer();
  if((state.refineMode==='add'||state.refineMode==='remove')&&active){combineMask(active,result.maskCanvas,state.refineMode);say(state.refineMode==='add'?'선택 영역을 추가했습니다':'선택 영역을 제거했습니다');state.showMask=true;return;}
  const layer=addLayer(result.maskCanvas,engine);if(!layer)return;state.showMask=true;updateLayerUI();drawOverlay();say('자동 레이어를 만들었습니다');setTool('stretch');
}

function beginGesture(){const pointers=[...state.pointers.values()];if(pointers.length<2)return;const[a,b]=pointers;state.gesture={dist:Math.hypot(b.x-a.x,b.y-a.y),scale:state.scale,tx:state.tx,ty:state.ty,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};state.drawing=false;}
function updateGesture(){const pointers=[...state.pointers.values()];if(pointers.length<2||!state.gesture)return;const[a,b]=pointers,cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,d=Math.hypot(b.x-a.x,b.y-a.y),ns=Math.max(.05,Math.min(7,state.gesture.scale*d/state.gesture.dist)),r=el.viewport.getBoundingClientRect(),ixp=(state.gesture.cx-r.left-state.gesture.tx)/state.gesture.scale,iyp=(state.gesture.cy-r.top-state.gesture.ty)/state.gesture.scale;state.scale=ns;state.tx=cx-r.left-ixp*ns;state.ty=cy-r.top-iyp*ns;applyTransform();drawOverlay();}