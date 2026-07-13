const els = {
  fileInput: document.getElementById('fileInput'), replaceInput: document.getElementById('replaceInput'),
  emptyState: document.getElementById('emptyState'), canvasWrap: document.getElementById('canvasWrap'),
  canvas: document.getElementById('canvas'), controls: document.getElementById('controls'),
  cursorGuide: document.getElementById('cursorGuide'), undoBtn: document.getElementById('undoBtn'),
  resetBtn: document.getElementById('resetBtn'), saveBtn: document.getElementById('saveBtn'),
  lengthRange: document.getElementById('lengthRange'), thicknessRange: document.getElementById('thicknessRange'), opacityRange: document.getElementById('opacityRange'),
  lengthValue: document.getElementById('lengthValue'), thicknessValue: document.getElementById('thicknessValue'), opacityValue: document.getElementById('opacityValue'),
  helpBtn: document.getElementById('helpBtn'), helpDialog: document.getElementById('helpDialog'), closeHelp: document.getElementById('closeHelp')
};

const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
let originalImage = null;
let history = [];
let tool = 'line';
let direction = 'horizontal';
let drawing = false;
let lastBrushPoint = null;

function fitCanvasToImage(img){
  const maxDim = 2200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  els.canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  els.canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
}

function loadFile(file){
  if(!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    fitCanvasToImage(img);
    ctx.clearRect(0,0,els.canvas.width,els.canvas.height);
    ctx.drawImage(img,0,0,els.canvas.width,els.canvas.height);
    originalImage = ctx.getImageData(0,0,els.canvas.width,els.canvas.height);
    history = [];
    updateUndo();
    els.emptyState.classList.add('hidden');
    els.canvasWrap.classList.remove('hidden');
    els.controls.classList.remove('hidden');
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function snapshot(){
  history.push(ctx.getImageData(0,0,els.canvas.width,els.canvas.height));
  if(history.length > 20) history.shift();
  updateUndo();
}
function updateUndo(){ els.undoBtn.disabled = history.length === 0; }
function undo(){ const state = history.pop(); if(state){ ctx.putImageData(state,0,0); updateUndo(); } }
function reset(){ if(!originalImage) return; snapshot(); ctx.putImageData(originalImage,0,0); }

function canvasPoint(evt){
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(els.canvas.width-1, (evt.clientX-rect.left) * els.canvas.width/rect.width)),
    y: Math.max(0, Math.min(els.canvas.height-1, (evt.clientY-rect.top) * els.canvas.height/rect.height))
  };
}

function stretchAt(x,y,saveState=true){
  if(saveState) snapshot();
  const len = Number(els.lengthRange.value);
  const thick = Number(els.thicknessRange.value);
  const alpha = Number(els.opacityRange.value)/100;
  const w = els.canvas.width, h = els.canvas.height;
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
  if(direction === 'horizontal'){
    const sy = Math.max(0, Math.round(y-thick/2));
    const sh = Math.min(thick, h-sy);
    const sx = Math.max(0, Math.round(x));
    const sample = ctx.getImageData(sx, sy, 1, sh);
    const off = document.createElement('canvas'); off.width=1; off.height=sh; off.getContext('2d').putImageData(sample,0,0);
    const drawX = Math.max(0, Math.min(w-len, sx-len/2));
    ctx.drawImage(off,0,0,1,sh,drawX,sy,Math.min(len,w-drawX),sh);
  }else{
    const sx = Math.max(0, Math.round(x-thick/2));
    const sw = Math.min(thick, w-sx);
    const sy = Math.max(0, Math.round(y));
    const sample = ctx.getImageData(sx, sy, sw, 1);
    const off = document.createElement('canvas'); off.width=sw; off.height=1; off.getContext('2d').putImageData(sample,0,0);
    const drawY = Math.max(0, Math.min(h-len, sy-len/2));
    ctx.drawImage(off,0,0,sw,1,sx,drawY,sw,Math.min(len,h-drawY));
  }
  ctx.restore();
}

function brushStroke(a,b){
  const dist = Math.hypot(b.x-a.x,b.y-a.y);
  const step = Math.max(3, Number(els.thicknessRange.value)*0.35);
  const count = Math.max(1, Math.ceil(dist/step));
  for(let i=0;i<=count;i++){
    const t=i/count;
    stretchAt(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,false);
  }
}

function pointerDown(evt){
  if(!originalImage) return; evt.preventDefault();
  drawing = true; const p=canvasPoint(evt);
  if(tool==='line'){ stretchAt(p.x,p.y,true); drawing=false; }
  else { snapshot(); lastBrushPoint=p; stretchAt(p.x,p.y,false); }
}
function pointerMove(evt){
  if(!drawing || tool!=='brush') return; evt.preventDefault();
  const p=canvasPoint(evt); brushStroke(lastBrushPoint,p); lastBrushPoint=p;
}
function pointerUp(){ drawing=false; lastBrushPoint=null; }

async function saveImage(){
  const blob = await new Promise(res => els.canvas.toBlob(res,'image/png',1));
  if(!blob) return;
  const file = new File([blob], `pixel-stretch-${Date.now()}.png`, {type:'image/png'});
  try{
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:'Pixel Stretch'});
      return;
    }
  }catch(e){ if(e.name==='AbortError') return; }
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=file.name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

[els.fileInput,els.replaceInput].forEach(input=>input.addEventListener('change',e=>loadFile(e.target.files[0])));
els.canvas.addEventListener('pointerdown',pointerDown);
els.canvas.addEventListener('pointermove',pointerMove);
window.addEventListener('pointerup',pointerUp);
window.addEventListener('pointercancel',pointerUp);
els.undoBtn.addEventListener('click',undo); els.resetBtn.addEventListener('click',reset); els.saveBtn.addEventListener('click',saveImage);

document.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-tool]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');tool=btn.dataset.tool;}));
document.querySelectorAll('[data-direction]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-direction]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');direction=btn.dataset.direction;}));

function bindRange(range,out,format=v=>v){ const update=()=>out.value=format(range.value); range.addEventListener('input',update); update(); }
bindRange(els.lengthRange,els.lengthValue); bindRange(els.thicknessRange,els.thicknessValue); bindRange(els.opacityRange,els.opacityValue,v=>`${v}%`);
els.helpBtn.addEventListener('click',()=>els.helpDialog.showModal()); els.closeHelp.addEventListener('click',()=>els.helpDialog.close());

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
