const effectBehindBtn = document.querySelector('#effectBehindBtn');
const effectFrontBtn = document.querySelector('#effectFrontBtn');
const layerPlacementText = document.querySelector('#layerPlacementText');

el.removeLayer.addEventListener('click', () => {
  if (!state.activeLayerId) return;
  const index = state.layers.findIndex((layer) => layer.id === state.activeLayerId);
  if (index < 0) return;
  const [removed] = state.layers.splice(index, 1);
  state.activeLayerId = state.layers[Math.min(index, state.layers.length - 1)]?.id || null;
  state.showMask = false;
  scheduleForegroundRender();
  updateLayerUI();
  drawOverlay();
  say(`${removed.name} 레이어를 삭제했습니다`);
});

el.layerList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layer-id]');
  if (!button) return;
  state.activeLayerId = button.dataset.layerId;
  state.showMask = true;
  updateLayerUI();
  drawOverlay();
});

function setActiveLayerPlacement(placement) {
  const layer = activeLayer();
  if (!layer) return;
  layer.effectPlacement = placement;
  scheduleForegroundRender();
  updateLayerUI();
  drawOverlay();
  say(placement === 'behind' ? `${layer.name} 뒤에 효과를 배치합니다` : `${layer.name} 앞에 효과를 배치합니다`);
}

effectBehindBtn.addEventListener('click', () => setActiveLayerPlacement('behind'));
effectFrontBtn.addEventListener('click', () => setActiveLayerPlacement('front'));

function updateLayerUI() {
  state.layers.forEach((layer) => {
    if (!layer.effectPlacement) layer.effectPlacement = 'behind';
  });
  const active = activeLayer();
  el.layerCount.textContent = String(state.layers.length);
  el.layerList.innerHTML = state.layers.length
    ? state.layers.map((layer) => {
        const label = layer.effectPlacement === 'behind' ? '뒤' : '앞';
        return `<button class="layer-chip${layer.id === state.activeLayerId ? ' active' : ''}" data-layer-id="${layer.id}">${layer.name}<small>${label}</small></button>`;
      }).join('')
    : '<span class="layer-empty">아직 선택된 요소가 없습니다</span>';
  el.previewMask.disabled = !active;
  el.removeLayer.disabled = !active;
  el.previewMask.classList.toggle('active', Boolean(active && state.showMask));
  el.previewMask.textContent = state.showMask ? '마스크 숨기기' : '마스크 보기';
  el.layerBadge.classList.toggle('hidden', !state.layers.length);
  el.layerBadgeText.textContent = state.layers.length ? `요소 ${state.layers.length}개 설정됨` : '';

  effectBehindBtn.disabled = !active;
  effectFrontBtn.disabled = !active;
  if (active) {
    layerPlacementText.textContent = active.effectPlacement === 'behind' ? '요소 뒤' : '요소 앞';
    effectBehindBtn.classList.toggle('active', active.effectPlacement === 'behind');
    effectFrontBtn.classList.toggle('active', active.effectPlacement === 'front');
  } else {
    layerPlacementText.textContent = '레이어 선택';
    effectBehindBtn.classList.remove('active');
    effectFrontBtn.classList.remove('active');
  }

  const behind = state.layers.filter((layer) => layer.effectPlacement === 'behind').map((layer) => layer.name);
  const front = state.layers.filter((layer) => layer.effectPlacement === 'front').map((layer) => layer.name);
  const summary = [];
  if (behind.length) summary.push(`${behind.join(' · ')} 뒤`);
  if (front.length) summary.push(`${front.join(' · ')} 앞`);
  el.effectTargetText.textContent = summary.length ? summary.join(' / ') : '자동 레이어를 먼저 선택하세요';
  updateHint();
}

function metrics(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 1;
  return { dx, dy, d: distance, angle: Math.atan2(dy, dx) };
}

function makeStrip() {
  if (state.line.length < 2 || !state.imageData) return null;
  const a = state.line[0];
  const b = state.line[1];
  const m = metrics(a, b);
  const thickness = Math.max(1, Math.round(Number(el.size.value) * 0.16));
  const strip = document.createElement('canvas');
  strip.width = Math.max(2, Math.round(m.d));
  strip.height = thickness;
  const context = strip.getContext('2d');
  const output = context.createImageData(strip.width, thickness);
  const source = state.imageData;
  for (let x = 0; x < strip.width; x += 1) {
    const t = x / Math.max(1, strip.width - 1);
    const px = a.x + m.dx * t;
    const py = a.y + m.dy * t;
    const nx = -Math.sin(m.angle);
    const ny = Math.cos(m.angle);
    for (let y = 0; y < thickness; y += 1) {
      const offset = y - (thickness - 1) / 2;
      const sx = Math.max(0, Math.min(el.image.width - 1, Math.round(px + nx * offset)));
      const sy = Math.max(0, Math.min(el.image.height - 1, Math.round(py + ny * offset)));
      const sourceIndex = (sy * el.image.width + sx) * 4;
      const targetIndex = (y * strip.width + x) * 4;
      output.data[targetIndex] = source.data[sourceIndex];
      output.data[targetIndex + 1] = source.data[sourceIndex + 1];
      output.data[targetIndex + 2] = source.data[sourceIndex + 2];
      output.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  context.putImageData(output, 0, 0);
  return strip;
}

function makeMaskPreview(maskCanvas) {
  const preview = document.createElement('canvas');
  preview.width = state.sourceCanvas.width;
  preview.height = state.sourceCanvas.height;
  const context = preview.getContext('2d');
  context.fillStyle = 'rgba(130,255,197,.72)';
  context.fillRect(0, 0, preview.width, preview.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskCanvas, 0, 0, preview.width, preview.height);
  context.globalCompositeOperation = 'source-over';
  return preview;
}

function drawOverlay() {
  ox.clearRect(0, 0, el.overlay.width, el.overlay.height);
  if (!state.imageRect) return;
  const layer = activeLayer();
  if (layer && (state.showMask || state.tool === 'layer')) {
    ox.save();
    ox.globalAlpha = state.tool === 'layer' ? 0.5 : 0.32;
    ox.drawImage(layer.previewCanvas, state.imageRect.x, state.imageRect.y, state.imageRect.w, state.imageRect.h);
    ox.restore();
  }
  if (state.tool === 'layer' && state.drawing && state.lastPoint) {
    ox.save();
    ox.beginPath();
    ox.arc(state.lastPoint.x, state.lastPoint.y, Math.max(7, 10 / state.scale), 0, Math.PI * 2);
    ox.fillStyle = '#fff';
    ox.fill();
    ox.beginPath();
    ox.arc(state.lastPoint.x, state.lastPoint.y, Math.max(12, 17 / state.scale), 0, Math.PI * 2);
    ox.strokeStyle = '#82ffc5';
    ox.lineWidth = Math.max(2, 3 / state.scale);
    ox.stroke();
    ox.restore();
  }
  if (state.line.length === 2) {
    const [a, b] = state.line;
    ox.save();
    ox.beginPath();
    ox.moveTo(a.x, a.y);
    ox.lineTo(b.x, b.y);
    ox.strokeStyle = '#c9ff45';
    ox.lineWidth = Math.max(2, 3 / state.scale);
    ox.lineCap = 'round';
    ox.setLineDash([8 / state.scale, 6 / state.scale]);
    ox.stroke();
    [a, b].forEach((p) => {
      ox.beginPath();
      ox.arc(p.x, p.y, Math.max(4, 5 / state.scale), 0, Math.PI * 2);
      ox.fillStyle = '#fff';
      ox.fill();
    });
    ox.restore();
  }
}

function scheduleForegroundRender() {
  cancelAnimationFrame(state.foregroundRaf);
  state.foregroundRaf = requestAnimationFrame(renderForeground);
}

function renderForeground() {
  if (!state.imageRect) return;
  fg.clearRect(0, 0, el.foreground.width, el.foreground.height);
  const protectedLayers = state.layers.filter((layer) => (layer.effectPlacement || 'behind') === 'behind');
  if (!protectedLayers.length) return;
  const width = state.sourceCanvas.width;
  const height = state.sourceCanvas.height;
  state.workCanvas.width = width;
  state.workCanvas.height = height;
  const context = state.workCanvas.getContext('2d');
  const feather = Number(el.feather.value);
  for (const layer of protectedLayers) {
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    context.drawImage(state.sourceCanvas, 0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    context.filter = feather > 0 ? `blur(${feather}px)` : 'none';
    context.drawImage(layer.maskCanvas, 0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    fg.drawImage(state.workCanvas, state.imageRect.x, state.imageRect.y, state.imageRect.w, state.imageRect.h);
  }
}

function stamp(p, angle) {
  if (!state.strip) return;
  const brushSize = Number(el.size.value);
  const density = Number(el.density.value) / 100;
  const softness = Number(el.softness.value);
  const opacity = Number(el.opacity.value) / 100;
  const modeScatter = state.mode === 'soft' ? 0.9 : state.mode === 'fan' ? 1.25 : 0.48;
  const scatter = brushSize * modeScatter;
  const count = Math.max(1, Math.round(2 + density * (state.mode === 'soft' ? 10 : 7)));
  fx.save();
  fx.globalAlpha = opacity / (state.mode === 'soft' ? 2.25 : 1.35);
  fx.imageSmoothingEnabled = state.mode !== 'solid';
  fx.filter = softness > 0 ? `blur(${Math.max(0, softness / 25)}px)` : 'none';
  for (let i = 0; i < count; i += 1) {
    const across = (Math.random() - 0.5) * scatter;
    const along = (Math.random() - 0.5) * brushSize * 0.7;
    const x = p.x + Math.cos(angle) * along - Math.sin(angle) * across;
    const y = p.y + Math.sin(angle) * along + Math.cos(angle) * across;
    const sourceWidth = Math.max(1, Math.min(state.strip.width, Math.round(state.strip.width * (0.08 + Math.random() * 0.3))));
    const sourceHeight = Math.max(1, Math.min(state.strip.height, Math.round(1 + Math.random() * state.strip.height)));
    const sourceX = Math.max(0, Math.floor(Math.random() * Math.max(1, state.strip.width - sourceWidth)));
    const sourceY = Math.max(0, Math.floor(Math.random() * Math.max(1, state.strip.height - sourceHeight)));
    const fan = state.mode === 'fan' ? 1 + Math.random() * 1.25 : 1;
    const width = Math.max(2, brushSize * (0.18 + Math.random() * 0.62) * fan);
    const height = Math.max(1, brushSize * (state.mode === 'solid' ? 0.12 + Math.random() * 0.2 : 0.08 + Math.random() * 0.24));
    const wobble = state.mode === 'curve' ? (Math.random() - 0.5) * 0.9 : (Math.random() - 0.5) * 0.25;
    fx.save();
    fx.translate(x, y);
    fx.rotate(angle + Math.PI / 2 + wobble);
    fx.drawImage(state.strip, sourceX, sourceY, sourceWidth, sourceHeight, -width / 2, -height / 2, width, height);
    fx.restore();
  }
  fx.restore();
}

function spraySegment(a, b) {
  const m = metrics(a, b);
  const spacing = Math.max(1.5, Number(el.size.value) * (0.72 - Number(el.density.value) / 180));
  for (let distance = 0; distance <= m.d; distance += spacing) {
    const t = distance / m.d;
    stamp({ x: a.x + m.dx * t, y: a.y + m.dy * t }, m.angle);
  }
}

function renderStretch(endPoint) {
  if (!state.preview || !state.strip || state.line.length < 2) return;
  fx.putImageData(state.preview, 0, 0);
  const base = metrics(state.line[0], state.line[1]);
  const center = {
    x: (state.line[0].x + state.line[1].x) / 2,
    y: (state.line[0].y + state.line[1].y) / 2,
  };
  const drag = metrics(center, endPoint);
  if (drag.d < 2) return;

  const opacity = Number(el.opacity.value) / 100;
  const softness = Number(el.softness.value);
  const thicknessScale = Math.max(0.65, Number(el.size.value) / 24);
  const step = Math.max(1.25, state.strip.height * 0.7);
  const steps = Math.max(2, Math.ceil(drag.d / step));
  const curveAmount = state.mode === 'curve' ? drag.d * 0.2 : 0;

  fx.save();
  fx.globalAlpha = opacity;
  fx.imageSmoothingEnabled = state.mode !== 'solid';
  fx.filter = softness > 0 ? `blur(${Math.max(0, softness / 36)}px)` : 'none';

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    const bend = Math.sin(Math.PI * t) * curveAmount;
    const x = center.x + drag.dx * ease - Math.sin(drag.angle) * bend;
    const y = center.y + drag.dy * ease + Math.cos(drag.angle) * bend;
    let widthScale = 1;
    if (state.mode === 'fan') widthScale = 1 + ease * 0.8;
    else if (state.mode === 'soft') widthScale = 1 + ease * 0.08;
    else if (state.mode === 'curve') widthScale = 1 + ease * 0.18;
    const drawWidth = state.strip.width * widthScale;
    const drawHeight = Math.max(1, step * 1.35 * thicknessScale);
    fx.save();
    fx.translate(x, y);
    fx.rotate(base.angle);
    fx.drawImage(state.strip, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    fx.restore();
  }
  fx.restore();
}