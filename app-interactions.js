el.viewport.addEventListener('pointerdown', (event) => {
  el.viewport.setPointerCapture(event.pointerId);
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.pointers.size === 2) {
    beginGesture();
    return;
  }
  if (state.pointers.size > 1) return;
  const p = point(event.clientX, event.clientY);
  state.lastClient = { x: event.clientX, y: event.clientY };
  state.lastPoint = p;
  state.dragStart = p;
  state.layerTapMoved = false;

  if (state.tool === 'hand') {
    state.drawing = true;
    return;
  }
  if (!inImage(p) && (state.tool === 'layer' || state.tool === 'pick')) {
    say('사진 안에서 선택하세요');
    return;
  }
  if (state.tool === 'layer') {
    if (state.segmentationBusy) return;
    state.drawing = true;
    drawOverlay();
    return;
  }
  if (state.tool === 'pick') {
    state.line = [p, p];
    state.drawing = true;
    drawOverlay();
    return;
  }
  if (!state.strip) {
    say('먼저 픽셀 선택선을 그어주세요');
    return;
  }
  snapshot();
  state.preview = fx.getImageData(0, 0, el.effect.width, el.effect.height);
  state.drawing = true;
  if (state.tool === 'spray') stamp(p, 0);
});

el.viewport.addEventListener('pointermove', (event) => {
  if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.pointers.size >= 2) {
    updateGesture();
    return;
  }
  if (!state.drawing) return;
  if (state.tool === 'hand') {
    state.tx += event.clientX - state.lastClient.x;
    state.ty += event.clientY - state.lastClient.y;
    state.lastClient = { x: event.clientX, y: event.clientY };
    applyTransform();
    return;
  }
  const p = point(event.clientX, event.clientY);
  if (state.tool === 'layer') {
    state.lastPoint = p;
    if (state.dragStart && Math.hypot(p.x - state.dragStart.x, p.y - state.dragStart.y) > Math.max(5, 10 / state.scale)) {
      state.layerTapMoved = true;
    }
    drawOverlay();
  } else if (state.tool === 'pick') {
    state.line[1] = clampToImage(p);
    drawOverlay();
  } else if (state.tool === 'spray') {
    spraySegment(state.lastPoint, p);
    state.lastPoint = p;
  } else if (state.tool === 'stretch') {
    renderStretch(p);
  }
});

function endPointer(event, cancelled = false) {
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) state.gesture = null;
  if (!state.drawing) return;

  if (state.tool === 'layer') {
    const target = state.lastPoint;
    const shouldSelect = !cancelled && !state.layerTapMoved && target && inImage(target);
    state.drawing = false;
    state.lastPoint = null;
    state.dragStart = null;
    drawOverlay();
    if (shouldSelect) void selectLayerAt(target);
    return;
  }

  if (state.tool === 'pick') {
    if (cancelled) {
      state.line = [];
    } else {
      const m = metrics(state.line[0], state.line[1]);
      if (m.d < 5) {
        state.line = [];
        say('선택선을 조금 더 길게 그어주세요');
      } else {
        state.strip = makeStrip();
        setTool('spray');
        say(state.layers.length ? '선택 요소 뒤로 픽셀을 뿌려보세요' : '이제 픽셀을 뿌려보세요');
      }
    }
    state.drawing = false;
    state.lastPoint = null;
    state.dragStart = null;
    drawOverlay();
    return;
  }

  if (state.tool === 'spray' || state.tool === 'stretch') {
    if (cancelled && state.preview) {
      fx.putImageData(state.preview, 0, 0);
      state.undo.pop();
      updateHistory();
    } else {
      say(state.layers.length ? '선택 요소 뒤에 효과를 적용했습니다' : '효과를 적용했습니다');
    }
  }
  state.drawing = false;
  state.preview = null;
  state.lastPoint = null;
  state.dragStart = null;
  updateHistory();
}

el.viewport.addEventListener('pointerup', (event) => endPointer(event, false));
el.viewport.addEventListener('pointercancel', (event) => endPointer(event, true));

el.viewport.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = el.viewport.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const imageX = (mouseX - state.tx) / state.scale;
    const imageY = (mouseY - state.ty) / state.scale;
    state.scale = Math.max(0.05, Math.min(7, state.scale * Math.exp(-event.deltaY * 0.001)));
    state.tx = mouseX - imageX * state.scale;
    state.ty = mouseY - imageY * state.scale;
    applyTransform();
    drawOverlay();
  },
  { passive: false },
);

async function save() {
  if (!state.imageRect) return;
  const output = document.createElement('canvas');
  output.width = el.effect.width;
  output.height = el.effect.height;
  const context = output.getContext('2d');
  context.drawImage(el.image, 0, 0);
  context.drawImage(el.effect, 0, 0);
  context.drawImage(el.foreground, 0, 0);
  const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png', 1));
  if (!blob) return;
  const file = new File([blob], `${state.fileName}-layered-pixel-${Date.now()}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Pixel Stretch' });
      return;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
  }
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
}

el.save.addEventListener('click', save);
window.addEventListener('beforeunload', () => state.segmenter?.close?.());
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
