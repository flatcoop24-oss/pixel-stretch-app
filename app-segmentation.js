async function ensureSegmenter() {
  if (state.segmenter) return state.segmenter;
  if (state.segmenterPromise) return state.segmenterPromise;
  state.segmenterPromise = (async () => {
    const visionTasks = await import(MEDIAPIPE_MODULE);
    const vision = await visionTasks.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    state.modelCanvas.width = 1;
    state.modelCanvas.height = 1;
    const baseOptions = {
      modelAssetPath: SEGMENT_MODEL,
      delegate: 'GPU',
    };
    const options = {
      baseOptions,
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
      canvas: state.modelCanvas,
    };
    try {
      return await visionTasks.InteractiveSegmenter.createFromOptions(vision, options);
    } catch (gpuError) {
      console.warn('GPU segmenter failed, retrying on CPU.', gpuError);
      return visionTasks.InteractiveSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SEGMENT_MODEL,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    }
  })();
  try {
    state.segmenter = await state.segmenterPromise;
    return state.segmenter;
  } finally {
    state.segmenterPromise = null;
  }
}

function maskCanvasFromCategory(categoryMask, tap) {
  const maskWidth = categoryMask.width;
  const maskHeight = categoryMask.height;
  const data = categoryMask.getAsUint8Array();
  const x = Math.max(0, Math.min(maskWidth - 1, Math.round(tap.x * (maskWidth - 1))));
  const y = Math.max(0, Math.min(maskHeight - 1, Math.round(tap.y * (maskHeight - 1))));
  const normalValue = data[y * maskWidth + x];
  const flippedValue = data[(maskHeight - 1 - y) * maskWidth + x];
  let flipY = false;
  let targetValue = 0;
  if (normalValue !== 0 && flippedValue === 0) flipY = true;
  else if (normalValue !== 0 && flippedValue !== 0) targetValue = normalValue;

  const pixels = new Uint8ClampedArray(maskWidth * maskHeight * 4);
  let selected = 0;
  for (let row = 0; row < maskHeight; row += 1) {
    const sourceRow = flipY ? maskHeight - 1 - row : row;
    for (let col = 0; col < maskWidth; col += 1) {
      const selectedPixel = data[sourceRow * maskWidth + col] === targetValue;
      const index = (row * maskWidth + col) * 4;
      if (selectedPixel) {
        pixels[index] = 255;
        pixels[index + 1] = 255;
        pixels[index + 2] = 255;
        pixels[index + 3] = 255;
        selected += 1;
      }
    }
  }
  const ratio = selected / Math.max(1, maskWidth * maskHeight);
  const lowMask = document.createElement('canvas');
  lowMask.width = maskWidth;
  lowMask.height = maskHeight;
  lowMask.getContext('2d').putImageData(new ImageData(pixels, maskWidth, maskHeight), 0, 0);

  const fullMask = document.createElement('canvas');
  fullMask.width = state.sourceCanvas.width;
  fullMask.height = state.sourceCanvas.height;
  const context = fullMask.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.drawImage(lowMask, 0, 0, fullMask.width, fullMask.height);
  return { maskCanvas: fullMask, ratio };
}

async function segmentWithAI(canvasPoint) {
  const segmenter = await ensureSegmenter();
  const rect = state.imageRect;
  const normalized = {
    x: Math.max(0, Math.min(1, (canvasPoint.x - rect.x) / rect.w)),
    y: Math.max(0, Math.min(1, (canvasPoint.y - rect.y) / rect.h)),
  };
  const result = segmenter.segment(state.sourceCanvas, { keypoint: normalized });
  if (!result.categoryMask) throw new Error('분할 마스크가 없습니다.');
  try {
    return maskCanvasFromCategory(result.categoryMask, normalized);
  } finally {
    result.categoryMask.close();
  }
}

function fallbackSmartMask(canvasPoint) {
  const sourceWidth = state.sourceCanvas.width;
  const sourceHeight = state.sourceCanvas.height;
  const maxSide = 420;
  const ratio = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(16, Math.round(sourceWidth * ratio));
  const height = Math.max(16, Math.round(sourceHeight * ratio));
  const low = document.createElement('canvas');
  low.width = width;
  low.height = height;
  const context = low.getContext('2d', { willReadFrequently: true });
  context.drawImage(state.sourceCanvas, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const rect = state.imageRect;
  const sx = Math.max(0, Math.min(width - 1, Math.round(((canvasPoint.x - rect.x) / rect.w) * (width - 1))));
  const sy = Math.max(0, Math.min(height - 1, Math.round(((canvasPoint.y - rect.y) / rect.h) * (height - 1))));
  const seedIndex = (sy * width + sx) * 4;
  const seed = [data[seedIndex], data[seedIndex + 1], data[seedIndex + 2]];
  const queued = new Uint8Array(width * height);
  const selected = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const seedPixel = sy * width + sx;
  queue[tail++] = seedPixel;
  queued[seedPixel] = 1;
  let count = 0;
  let meanR = seed[0];
  let meanG = seed[1];
  let meanB = seed[2];
  const maxCount = Math.floor(width * height * 0.78);

  const distance = (r, g, b, tr, tg, tb) => {
    const dr = r - tr;
    const dg = g - tg;
    const db = b - tb;
    return Math.sqrt(dr * dr * 0.32 + dg * dg * 0.5 + db * db * 0.18);
  };

  const enqueue = (pixel) => {
    if (queued[pixel] || tail >= queue.length) return;
    queued[pixel] = 1;
    queue[tail++] = pixel;
  };

  while (head < tail && count < maxCount) {
    const pixel = queue[head++];
    const index = pixel * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const seedDistance = distance(r, g, b, seed[0], seed[1], seed[2]);
    const meanDistance = distance(r, g, b, meanR, meanG, meanB);
    if (seedDistance > 70 && meanDistance > 32) continue;
    selected[pixel] = 1;
    count += 1;
    const learning = Math.min(0.02, 1 / Math.max(1, count));
    meanR += (r - meanR) * learning;
    meanG += (g - meanG) * learning;
    meanB += (b - meanB) * learning;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < selected.length; i += 1) {
    if (!selected[i]) continue;
    const index = i * 4;
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
    pixels[index + 3] = 255;
  }
  const lowMask = document.createElement('canvas');
  lowMask.width = width;
  lowMask.height = height;
  lowMask.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  const fullMask = document.createElement('canvas');
  fullMask.width = sourceWidth;
  fullMask.height = sourceHeight;
  const fullContext = fullMask.getContext('2d');
  fullContext.imageSmoothingEnabled = true;
  fullContext.drawImage(lowMask, 0, 0, sourceWidth, sourceHeight);
  return { maskCanvas: fullMask, ratio: count / Math.max(1, width * height) };
}

function addLayer(maskCanvas, engine) {
  if (state.layers.length >= MAX_LAYERS) {
    say(`레이어는 최대 ${MAX_LAYERS}개까지 만들 수 있습니다`);
    return null;
  }
  state.layerSequence += 1;
  const layer = {
    id: `layer-${Date.now()}-${state.layerSequence}`,
    name: `요소 ${state.layerSequence}`,
    maskCanvas,
    previewCanvas: makeMaskPreview(maskCanvas),
    engine,
  };
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  scheduleForegroundRender();
  updateLayerUI();
  return layer;
}

async function selectLayerAt(canvasPoint) {
  if (state.segmentationBusy || !inImage(canvasPoint)) return;
  if (state.layers.length >= MAX_LAYERS) {
    say(`기존 레이어를 삭제한 뒤 추가하세요`);
    return;
  }
  const token = state.imageToken;
  state.segmentationBusy = true;
  updateHint();
  setAIStatus(true, '요소 분석 중', 'AI가 탭한 사물의 경계를 찾고 있습니다');
  let result = null;
  let engine = 'AI';
  try {
    result = await segmentWithAI(canvasPoint);
    if (token !== state.imageToken) return;
    if (result.ratio < 0.002 || result.ratio > 0.94) throw new Error('선택 영역이 비정상적입니다.');
  } catch (error) {
    console.warn('AI segmentation failed. Using local fallback.', error);
    setAIStatus(true, '간편 선택 중', '기기 안에서 색상과 경계를 다시 계산합니다');
    result = fallbackSmartMask(canvasPoint);
    engine = '간편';
    if (result.ratio < 0.001 || result.ratio > 0.78) {
      say('요소 경계를 찾지 못했습니다 · 요소 중앙을 다시 탭하세요');
      return;
    }
  } finally {
    if (token === state.imageToken) {
      state.segmentationBusy = false;
      setAIStatus(false);
      updateHint();
    }
  }
  if (!result || token !== state.imageToken) return;
  const layer = addLayer(result.maskCanvas, engine);
  if (!layer) return;
  state.showMask = true;
  updateLayerUI();
  drawOverlay();
  say(`${layer.name} 자동 레이어를 만들었습니다`);
  setTimeout(() => {
    if (state.activeLayerId === layer.id && state.tool !== 'layer') {
      state.showMask = false;
      updateLayerUI();
      drawOverlay();
    }
  }, 1100);
  setTool('pick');
}

function beginGesture() {
  const pointers = [...state.pointers.values()];
  if (pointers.length < 2) return;
  const [a, b] = pointers;
  state.gesture = {
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    scale: state.scale,
    tx: state.tx,
    ty: state.ty,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
  state.drawing = false;
}

function updateGesture() {
  const pointers = [...state.pointers.values()];
  if (pointers.length < 2 || !state.gesture) return;
  const [a, b] = pointers;
  const centerX = (a.x + b.x) / 2;
  const centerY = (a.y + b.y) / 2;
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const nextScale = Math.max(0.05, Math.min(7, (state.gesture.scale * distance) / state.gesture.dist));
  const rect = el.viewport.getBoundingClientRect();
  const imageX = (state.gesture.cx - rect.left - state.gesture.tx) / state.gesture.scale;
  const imageY = (state.gesture.cy - rect.top - state.gesture.ty) / state.gesture.scale;
  state.scale = nextScale;
  state.tx = centerX - rect.left - imageX * nextScale;
  state.ty = centerY - rect.top - imageY * nextScale;
  applyTransform();
  drawOverlay();
}

