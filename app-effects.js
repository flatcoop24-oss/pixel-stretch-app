const effectBehindBtn = $('#effectBehindBtn');
const effectFrontBtn = $('#effectFrontBtn');
const layerPlacementText = $('#layerPlacementText');
const refineAddBtn = $('#refineAddBtn');
const refineRemoveBtn = $('#refineRemoveBtn');

state.refineMode = 'new';
state.autoSource = false;
state.stretchStart = null;

el.removeLayer.addEventListener('click', () => {
  const index = state.layers.findIndex((layer) => layer.id === state.activeLayerId);
  if (index < 0) return;
  state.layers.splice(index, 1);
  state.activeLayerId = state.layers[Math.min(index, state.layers.length - 1)]?.id || null;
  state.showMask = false;
  scheduleForegroundRender(); updateLayerUI(); drawOverlay();
});
el.layerList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layer-id]'); if (!button) return;
  state.activeLayerId = button.dataset.layerId; state.showMask = true; state.refineMode = 'new'; updateLayerUI(); drawOverlay();
});
function setPlacement(value) { const layer = activeLayer(); if (!layer) return; layer.effectPlacement = value; scheduleForegroundRender(); updateLayerUI(); say(value === 'behind' ? '픽셀을 요소 뒤에 배치합니다' : '픽셀을 요소 앞에 배치합니다'); }
effectBehindBtn.addEventListener('click', () => setPlacement('behind'));
effectFrontBtn.addEventListener('click', () => setPlacement('front'));
refineAddBtn.addEventListener('click', () => { if (!activeLayer()) return; state.refineMode = state.refineMode === 'add' ? 'new' : 'add'; setTool('layer'); updateLayerUI(); });
refineRemoveBtn.addEventListener('click', () => { if (!activeLayer()) return; state.refineMode = state.refineMode === 'remove' ? 'new' : 'remove'; setTool('layer'); updateLayerUI(); });

function updateLayerUI() {
  state.layers.forEach((layer) => { if (!layer.effectPlacement) layer.effectPlacement = 'behind'; });
  const active = activeLayer();
  el.layerCount.textContent = String(state.layers.length);
  el.layerList.innerHTML = state.layers.length ? state.layers.map((layer) => `<button class="layer-chip${layer.id === state.activeLayerId ? ' active' : ''}" data-layer-id="${layer.id}">${layer.name}<small>${layer.effectPlacement === 'behind' ? '뒤' : '앞'}</small></button>`).join('') : '<span class="layer-empty">아직 선택된 요소가 없습니다</span>';
  [el.previewMask, el.removeLayer, refineAddBtn, refineRemoveBtn, effectBehindBtn, effectFrontBtn].forEach((button) => { button.disabled = !active; });
  el.previewMask.classList.toggle('active', Boolean(active && state.showMask));
  el.previewMask.textContent = state.showMask ? '마스크 숨기기' : '마스크 보기';
  refineAddBtn.classList.toggle('active', state.refineMode === 'add');
  refineRemoveBtn.classList.toggle('active', state.refineMode === 'remove');
  effectBehindBtn.classList.toggle('active', Boolean(active && active.effectPlacement === 'behind'));
  effectFrontBtn.classList.toggle('active', Boolean(active && active.effectPlacement === 'front'));
  layerPlacementText.textContent = active ? (active.effectPlacement === 'behind' ? '요소 뒤' : '요소 앞') : '레이어 선택';
  el.layerBadge.classList.toggle('hidden', !state.layers.length);
  el.layerBadgeText.textContent = state.layers.length ? `요소 ${state.layers.length}개` : '';
  el.effectTargetText.textContent = active ? `${active.name} ${active.effectPlacement === 'behind' ? '뒤' : '앞'}` : '자동 레이어를 먼저 선택하세요';
  updateHint();
}

function metrics(a, b) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; return { dx, dy, d, angle: Math.atan2(dy, dx) }; }
function sourceValue(id, fallback) { const node = $(id); return node ? Number(node.value) : fallback; }

function makeStrip() {
  if (state.line.length < 2 || !state.imageData) return null;
  const a = state.line[0], b = state.line[1], m = metrics(a, b);
  const thickness = Math.max(1, Math.round(sourceValue('#density', 3)));
  const strip = document.createElement('canvas'); strip.width = Math.max(2, Math.round(m.d)); strip.height = thickness;
  const context = strip.getContext('2d'), output = context.createImageData(strip.width, thickness), source = state.imageData;
  for (let x = 0; x < strip.width; x += 1) {
    const t = x / Math.max(1, strip.width - 1), px = a.x + m.dx * t, py = a.y + m.dy * t, nx = -Math.sin(m.angle), ny = Math.cos(m.angle);
    for (let y = 0; y < thickness; y += 1) {
      const offset = y - (thickness - 1) / 2, sx = Math.max(0, Math.min(el.image.width - 1, Math.round(px + nx * offset))), sy = Math.max(0, Math.min(el.image.height - 1, Math.round(py + ny * offset))), si = (sy * el.image.width + sx) * 4, di = (y * strip.width + x) * 4;
      output.data[di] = source.data[si]; output.data[di + 1] = source.data[si + 1]; output.data[di + 2] = source.data[si + 2]; output.data[di + 3] = source.data[si + 3];
    }
  }
  context.putImageData(output, 0, 0); return strip;
}

function maskAlpha(layer, sx, sy) {
  if (!layer) return 0; const x = Math.max(0, Math.min(layer.maskCanvas.width - 1, Math.round(sx))), y = Math.max(0, Math.min(layer.maskCanvas.height - 1, Math.round(sy)));
  return layer.maskCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data[3];
}
function canvasToMaskPoint(p) { const r = state.imageRect; return { x: ((p.x - r.x) / r.w) * state.sourceCanvas.width, y: ((p.y - r.y) / r.h) * state.sourceCanvas.height }; }
function maskToCanvasPoint(p) { const r = state.imageRect; return { x: r.x + (p.x / state.sourceCanvas.width) * r.w, y: r.y + (p.y / state.sourceCanvas.height) * r.h }; }
function isBoundary(layer, x, y) {
  const c = maskAlpha(layer, x, y) > 127; return c !== (maskAlpha(layer, x + 2, y) > 127) || c !== (maskAlpha(layer, x - 2, y) > 127) || c !== (maskAlpha(layer, x, y + 2) > 127) || c !== (maskAlpha(layer, x, y - 2) > 127);
}
function nearestBoundary(p) {
  const layer = activeLayer(); if (!layer || !state.imageRect) return null;
  const q = canvasToMaskPoint(p), max = Math.max(24, Math.round(sourceValue('#size', 64) * 1.4));
  let best = null, bestD = Infinity;
  for (let radius = 0; radius <= max; radius += 3) {
    const samples = Math.max(16, Math.round(radius * 0.8));
    for (let i = 0; i < samples; i += 1) {
      const angle = (Math.PI * 2 * i) / samples, x = q.x + Math.cos(angle) * radius, y = q.y + Math.sin(angle) * radius;
      if (x < 2 || y < 2 || x >= layer.maskCanvas.width - 2 || y >= layer.maskCanvas.height - 2 || !isBoundary(layer, x, y)) continue;
      const d = Math.hypot(x - q.x, y - q.y); if (d < bestD) { bestD = d; best = { x, y }; }
    }
    if (best) break;
  }
  if (!best) return null;
  const gx = maskAlpha(layer, best.x + 3, best.y) - maskAlpha(layer, best.x - 3, best.y), gy = maskAlpha(layer, best.x, best.y + 3) - maskAlpha(layer, best.x, best.y - 3);
  let tx = -gy, ty = gx, len = Math.hypot(tx, ty); if (len < 1) { tx = 1; ty = 0; len = 1; }
  tx /= len; ty /= len;
  return { point: maskToCanvasPoint(best), tangent: { x: tx, y: ty } };
}
function prepareEdgeSource(p) {
  const edge = nearestBoundary(p); if (!edge) return false;
  const spanMask = sourceValue('#size', 64), spanCanvas = spanMask * (state.imageRect.w / state.sourceCanvas.width), half = spanCanvas / 2;
  state.line = [{ x: edge.point.x - edge.tangent.x * half, y: edge.point.y - edge.tangent.y * half }, { x: edge.point.x + edge.tangent.x * half, y: edge.point.y + edge.tangent.y * half }];
  state.strip = makeStrip(); state.autoSource = true; state.stretchStart = edge.point; drawOverlay(); return Boolean(state.strip);
}

function makeMaskPreview(maskCanvas) { const preview = document.createElement('canvas'); preview.width = state.sourceCanvas.width; preview.height = state.sourceCanvas.height; const c = preview.getContext('2d'); c.fillStyle = 'rgba(130,255,197,.72)'; c.fillRect(0, 0, preview.width, preview.height); c.globalCompositeOperation = 'destination-in'; c.drawImage(maskCanvas, 0, 0); return preview; }
function drawOverlay() {
  ox.clearRect(0, 0, el.overlay.width, el.overlay.height); if (!state.imageRect) return;
  const layer = activeLayer(); if (layer && (state.showMask || state.tool === 'layer')) { ox.save(); ox.globalAlpha = state.tool === 'layer' ? .48 : .25; ox.drawImage(layer.previewCanvas, state.imageRect.x, state.imageRect.y, state.imageRect.w, state.imageRect.h); ox.restore(); }
  if (state.line.length === 2) { const [a,b]=state.line; ox.save(); ox.beginPath(); ox.moveTo(a.x,a.y); ox.lineTo(b.x,b.y); ox.strokeStyle='#c9ff45'; ox.lineWidth=Math.max(2,3/state.scale); ox.setLineDash([8/state.scale,6/state.scale]); ox.stroke(); ox.restore(); }
  if (state.stretchStart && state.drawing && state.tool === 'stretch') { ox.save(); ox.beginPath(); ox.arc(state.stretchStart.x,state.stretchStart.y,Math.max(5,7/state.scale),0,Math.PI*2); ox.fillStyle='#fff'; ox.fill(); ox.restore(); }
}
function scheduleForegroundRender() { cancelAnimationFrame(state.foregroundRaf); state.foregroundRaf = requestAnimationFrame(renderForeground); }
function renderForeground() {
  if (!state.imageRect) return; fg.clearRect(0,0,el.foreground.width,el.foreground.height);
  const layers = state.layers.filter((layer) => (layer.effectPlacement || 'behind') === 'behind'); if (!layers.length) return;
  const w=state.sourceCanvas.width,h=state.sourceCanvas.height,c=state.workCanvas.getContext('2d'),feather=Number(el.feather.value); state.workCanvas.width=w;state.workCanvas.height=h;
  for(const layer of layers){c.clearRect(0,0,w,h);c.globalCompositeOperation='source-over';c.filter='none';c.drawImage(state.sourceCanvas,0,0);c.globalCompositeOperation='destination-in';c.filter=feather?`blur(${feather}px)`:'none';c.drawImage(layer.maskCanvas,0,0);c.globalCompositeOperation='source-over';c.filter='none';fg.drawImage(state.workCanvas,state.imageRect.x,state.imageRect.y,state.imageRect.w,state.imageRect.h);}
}

function stamp(p, angle) {
  if (!state.strip) return; const size=Math.max(4,sourceValue('#size',64)*.45), count=5, spread=size*.45;
  fx.save(); fx.globalAlpha=.35; for(let i=0;i<count;i++){const across=(Math.random()-.5)*spread,along=(Math.random()-.5)*size*.25;fx.save();fx.translate(p.x+Math.cos(angle)*along-Math.sin(angle)*across,p.y+Math.sin(angle)*along+Math.cos(angle)*across);fx.rotate(angle+Math.PI/2+(Math.random()-.5)*.18);fx.drawImage(state.strip,-size/2,-Math.max(1,state.strip.height)/2,size,Math.max(1,state.strip.height));fx.restore();} fx.restore();
}
function spraySegment(a,b){const m=metrics(a,b),spacing=Math.max(2,sourceValue('#size',64)*.12);for(let d=0;d<=m.d;d+=spacing){const t=d/m.d;stamp({x:a.x+m.dx*t,y:a.y+m.dy*t},m.angle);}}
function renderStretch(endPoint) {
  if (!state.preview || !state.strip || state.line.length < 2) return; fx.putImageData(state.preview,0,0);
  const start=state.stretchStart || {x:(state.line[0].x+state.line[1].x)/2,y:(state.line[0].y+state.line[1].y)/2},drag=metrics(start,endPoint); if(drag.d<2)return;
  const sourceAngle=metrics(state.line[0],state.line[1]).angle, endScale=sourceValue('#softness',100)/100, manualCurve=sourceValue('#opacity',0)/100, modeCurve=state.mode==='curve'?(manualCurve||.35):manualCurve, steps=Math.max(4,Math.ceil(drag.d/1.25));
  fx.save();fx.globalAlpha=1;fx.imageSmoothingEnabled=true;
  for(let i=0;i<=steps;i++){const t=i/steps,e=t*t*(3-2*t),bend=Math.sin(Math.PI*t)*drag.d*modeCurve*.55,x=start.x+drag.dx*e-Math.sin(drag.angle)*bend,y=start.y+drag.dy*e+Math.cos(drag.angle)*bend;let scale=1+(endScale-1)*e;if(state.mode==='fan')scale=Math.max(scale,1+e*.8);if(state.mode==='taper')scale=Math.min(scale,1-e*.65);const w=Math.max(1,state.strip.width*scale),h=Math.max(1,drag.d/steps+1.4);fx.save();fx.translate(x,y);fx.rotate(sourceAngle);fx.drawImage(state.strip,-w/2,-h/2,w,h);fx.restore();}
  fx.restore();
}