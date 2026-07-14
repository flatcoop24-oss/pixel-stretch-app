const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const el={canvas:$('#canvas'),stage:$('#stage'),viewport:$('#viewport'),empty:$('#emptyState'),panel:$('#panel'),first:$('#firstInput'),file:$('#fileInput'),cursor:$('#brushCursor'),zoom:$('#zoomText'),fit:$('#fitBtn'),slice:$('#slice'),opacity:$('#opacity'),blend:$('#blend'),sliceOut:$('#sliceOut'),opacityOut:$('#opacityOut'),blendOut:$('#blendOut'),undo:$('#undoBtn'),redo:$('#redoBtn'),reset:$('#resetBtn'),save:$('#saveBtn'),toast:$('#toast'),help:$('#helpDialog'),helpBtn:$('#helpBtn'),closeHelp:$('#closeHelp')};
const ctx=el.canvas.getContext('2d',{willReadFrequently:true});
const isiOS=/iPhone|iPad|iPod/i.test(navigator.userAgent);const MAX_DIM=isiOS?2048:3072,MAX_HISTORY=isiOS?3:6;
const state={tool:'scanx',scale:1,tx:0,ty:0,pointers:new Map(),gesture:null,drawing:false,start:null,last:null,preview:null,original:null,undo:[],redo:[],fileName:'image'};
function say(t){el.toast.textContent=t;el.toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>el.toast.classList.remove('show'),1500)}
function sync(){el.sliceOut.value=`${el.slice.value}px`;el.opacityOut.value=`${el.opacity.value}%`;el.blendOut.value=`${el.blend.value}%`}[el.slice,el.opacity,el.blend].forEach(x=>x.addEventListener('input',sync));sync();
async function loadFile(file){if(!file||!file.type.startsWith('image/'))return;const bmp=await createImageBitmap(file);const s=Math.min(1,MAX_DIM/Math.max(bmp.width,bmp.height));el.canvas.width=Math.max(1,Math.round(bmp.width*s));el.canvas.height=Math.max(1,Math.round(bmp.height*s));ctx.clearRect(0,0,el.canvas.width,el.canvas.height);ctx.drawImage(bmp,0,0,el.canvas.width,el.canvas.height);bmp.close();state.original=ctx.getImageData(0,0,el.canvas.width,el.canvas.height);state.undo=[];state.redo=[];state.fileName=(file.name||'image').replace(/\.[^.]+$/,'');el.empty.classList.add('hidden');el.viewport.classList.remove('hidden');el.panel.classList.remove('hidden');updateHistory();requestAnimationFrame(fitView);say('사진을 불러왔습니다')}
[el.first,el.file].forEach(i=>i.addEventListener('change',e=>loadFile(e.target.files[0])));
function fitView(){const r=el.viewport.getBoundingClientRect(),p=20;state.scale=Math.max(.05,Math.min(8,Math.min((r.width-p*2)/el.canvas.width,(r.height-p*2)/el.canvas.height)));state.tx=(r.width-el.canvas.width*state.scale)/2;state.ty=(r.height-el.canvas.height*state.scale)/2;applyTransform()}
function applyTransform(){el.stage.style.transform=`translate(${state.tx}px,${state.ty}px) scale(${state.scale})`;el.zoom.textContent=`${Math.round(state.scale*100)}%`}
el.fit.onclick=fitView;window.addEventListener('resize',()=>state.original&&fitView());
function point(x,y){const r=el.viewport.getBoundingClientRect();return{x:(x-r.left-state.tx)/state.scale,y:(y-r.top-state.ty)/state.scale}}
function inside(p){return p.x>=0&&p.y>=0&&p.x<el.canvas.width&&p.y<el.canvas.height}
function snapshot(){state.undo.push(ctx.getImageData(0,0,el.canvas.width,el.canvas.height));if(state.undo.length>MAX_HISTORY)state.undo.shift();state.redo=[];updateHistory()}
function updateHistory(){el.undo.disabled=!state.undo.length;el.redo.disabled=!state.redo.length}
function undo(){if(!state.undo.length)return;state.redo.push(ctx.getImageData(0,0,el.canvas.width,el.canvas.height));ctx.putImageData(state.undo.pop(),0,0);updateHistory()}
function redo(){if(!state.redo.length)return;state.undo.push(ctx.getImageData(0,0,el.canvas.width,el.canvas.height));ctx.putImageData(state.redo.pop(),0,0);updateHistory()}
el.undo.onclick=undo;el.redo.onclick=redo;el.reset.onclick=()=>{if(!state.original)return;snapshot();ctx.putImageData(state.original,0,0);say('원본으로 복원했습니다')};
function applyScan(a,b){ctx.putImageData(state.preview,0,0);const sw=Math.max(1,Number(el.slice.value)),alpha=Number(el.opacity.value)/100,blend=Number(el.blend.value)/100;ctx.save();ctx.globalAlpha=alpha;ctx.imageSmoothingEnabled=false;
 if(state.tool==='scanx'){
  const sx=Math.max(0,Math.min(el.canvas.width-sw,Math.round(a.x-sw/2)));const x1=Math.round(a.x),x2=Math.round(b.x);const dx=Math.min(x1,x2),dw=Math.max(1,Math.abs(x2-x1));
  ctx.drawImage(el.canvas,sx,0,sw,el.canvas.height,dx,0,dw,el.canvas.height);
  if(blend>0){const g=ctx.createLinearGradient(dx,0,dx+dw,0);if(x2>=x1){g.addColorStop(0,`rgba(255,255,255,${1-blend})`);g.addColorStop(Math.min(1,blend), 'rgba(255,255,255,1)')}else{g.addColorStop(Math.max(0,1-blend),'rgba(255,255,255,1)');g.addColorStop(1,`rgba(255,255,255,${1-blend})`)}ctx.globalCompositeOperation='destination-in';ctx.fillStyle=g;ctx.fillRect(dx,0,dw,el.canvas.height)}
 }else{
  const sy=Math.max(0,Math.min(el.canvas.height-sw,Math.round(a.y-sw/2)));const y1=Math.round(a.y),y2=Math.round(b.y);const dy=Math.min(y1,y2),dh=Math.max(1,Math.abs(y2-y1));
  ctx.drawImage(el.canvas,0,sy,el.canvas.width,sw,0,dy,el.canvas.width,dh);
 }
 ctx.restore();
}
function beginGesture(){const p=[...state.pointers.values()];if(p.length<2)return;const a=p[0],b=p[1];state.gesture={dist:Math.hypot(b.x-a.x,b.y-a.y),scale:state.scale,tx:state.tx,ty:state.ty,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};state.drawing=false}
function updateGesture(){const p=[...state.pointers.values()];if(p.length<2||!state.gesture)return;const a=p[0],b=p[1],cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,d=Math.hypot(b.x-a.x,b.y-a.y),ns=Math.max(.05,Math.min(8,state.gesture.scale*d/state.gesture.dist)),r=el.viewport.getBoundingClientRect(),ix=(state.gesture.cx-r.left-state.gesture.tx)/state.gesture.scale,iy=(state.gesture.cy-r.top-state.gesture.ty)/state.gesture.scale;state.scale=ns;state.tx=cx-r.left-ix*ns;state.ty=cy-r.top-iy*ns;applyTransform()}
el.viewport.addEventListener('pointerdown',e=>{el.viewport.setPointerCapture(e.pointerId);state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(state.pointers.size===2){beginGesture();return}if(state.pointers.size>1)return;const p=point(e.clientX,e.clientY);state.last={clientX:e.clientX,clientY:e.clientY};if(state.tool==='hand'){state.drawing=true;return}if(!inside(p))return;snapshot();state.preview=ctx.getImageData(0,0,el.canvas.width,el.canvas.height);state.start=p;state.drawing=true});
el.viewport.addEventListener('pointermove',e=>{if(state.pointers.has(e.pointerId))state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(state.pointers.size>=2){updateGesture();return}if(!state.drawing)return;if(state.tool==='hand'){state.tx+=e.clientX-state.last.clientX;state.ty+=e.clientY-state.last.clientY;state.last={clientX:e.clientX,clientY:e.clientY};applyTransform();return}const p=point(e.clientX,e.clientY);applyScan(state.start,p)});
function end(e){state.pointers.delete(e.pointerId);if(state.pointers.size<2)state.gesture=null;state.drawing=false;state.start=null;state.preview=null}
el.viewport.addEventListener('pointerup',end);el.viewport.addEventListener('pointercancel',end);
el.viewport.addEventListener('wheel',e=>{e.preventDefault();const r=el.viewport.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,ix=(mx-state.tx)/state.scale,iy=(my-state.ty)/state.scale;state.scale=Math.max(.05,Math.min(8,state.scale*Math.exp(-e.deltaY*.001)));state.tx=mx-ix*state.scale;state.ty=my-iy*state.scale;applyTransform()},{passive:false});
$$('[data-tool]').forEach(b=>b.onclick=()=>{$$('[data-tool]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.tool=b.dataset.tool});
async function save(){const blob=await new Promise(r=>el.canvas.toBlob(r,'image/png',1));if(!blob)return;const file=new File([blob],`${state.fileName}-pixel-stretch-${Date.now()}.png`,{type:'image/png'});try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Pixel Stretch'});return}}catch(e){if(e.name==='AbortError')return}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
el.save.onclick=save;el.helpBtn.onclick=()=>el.help.showModal();el.closeHelp.onclick=()=>el.help.close();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
