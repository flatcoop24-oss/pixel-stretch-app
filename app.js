const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const MEDIAPIPE_VERSION = '0.10.35';
const MEDIAPIPE_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const SEGMENT_MODEL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';

const el = {
  image: $('#imageCanvas'),
  effect: $('#effectCanvas'),
  foreground: $('#foregroundCanvas'),
  overlay: $('#overlay'),
  stage: $('#stage'),
  viewport: $('#viewport'),
  empty: $('#emptyState'),
  controls: $('#controls'),
  layerControls: $('#layerControls'),
  effectControls: $('#effectControls'),
  first: $('#firstInput'),
  file: $('#fileInput'),
  fit: $('#fitBtn'),
  hint: $('#hint'),
  aiStatus: $('#aiStatus'),
  aiStatusTitle: $('#aiStatusTitle'),
  aiStatusText: $('#aiStatusText'),
  layerBadge: $('#layerBadge'),
  layerBadgeText: $('#layerBadgeText'),
  layerCount: $('#layerCount'),
  layerList: $('#layerList'),
  addLayer: $('#addLayerBtn'),
  previewMask: $('#previewMaskBtn'),
  removeLayer: $('#removeLayerBtn'),
  effectTargetText: $('#effectTargetText'),
  undo: $('#undoBtn'),
  redo: $('#redoBtn'),
  reset: $('#resetBtn'),
  save: $('#saveBtn'),
  reselect: $('#reselectBtn'),
  clear: $('#clearEffectBtn'),
  size: $('#size'),
  density: $('#density'),
  softness: $('#softness'),
  opacity: $('#opacity'),
  feather: $('#feather'),
  sizeOut: $('#sizeOut'),
  densityOut: $('#densityOut'),
  softnessOut: $('#softnessOut'),
  opacityOut: $('#opacityOut'),
  featherOut: $('#featherOut'),
  toast: $('#toast'),
};

const ix = el.image.getContext('2d', { willReadFrequently: true });
const fx = el.effect.getContext('2d', { willReadFrequently: true });
const fg = el.foreground.getContext('2d');
const ox = el.overlay.getContext('2d');

const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const MAX_IMAGE = isiOS ? 1320 : 1900;
const MAX_HISTORY = isiOS ? 3 : 7;
const MAX_LAYERS = isiOS ? 4 : 7;

const state = {
  tool: 'layer',
  mode: 'soft',
  scale: 1,
  tx: 0,
  ty: 0,
  pointers: new Map(),
  gesture: null,
  drawing: false,
  lastClient: null,
  lastPoint: null,
  dragStart: null,
  layerTapMoved: false,
  sourceCanvas: document.createElement('canvas'),
  sourceImageData: null,
  imageData: null,
  imageRect: null,
  line: [],
  strip: null,
  preview: null,
  undo: [],
  redo: [],
  fileName: 'image',
  layers: [],
  activeLayerId: null,
  showMask: false,
  layerSequence: 0,
  segmentationBusy: false,
  segmenter: null,
  segmenterPromise: null,
  modelCanvas: document.createElement('canvas'),
  workCanvas: document.createElement('canvas'),
  imageToken: 0,
  foregroundRaf: 0,
};

function say(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  clearTimeout(say.timer);
  say.timer = setTimeout(() => el.toast.classList.remove('show'), 1750);
}

function syncOutputs() {
  el.sizeOut.value = el.size.value;
  el.densityOut.value = el.density.value;
  el.softnessOut.value = el.softness.value;
  el.opacityOut.value = el.opacity.value;
  el.featherOut.value = el.feather.value;
}

[el.size, el.density, el.softness, el.opacity].forEach((input) => {
  input.addEventListener('input', () => {
    syncOutputs();
    if (input === el.size && state.line.length === 2) state.strip = makeStrip();
  });
});
el.feather.addEventListener('input', () => {
  syncOutputs();
  scheduleForegroundRender();
});
syncOutputs();

function activeLayer() {
  return state.layers.find((layer) => layer.id === state.activeLayerId) || null;
}

function updateHint() {
  const hasLayers = state.layers.length > 0;
  const hints = {
    layer: state.segmentationBusy
      ? '사진 속 요소를 분석하고 있습니다'
      : hasLayers
        ? '추가로 보호할 요소를 탭하거나 아래 레이어를 선택하세요'
        : '효과 앞에 남길 요소를 한 번 탭하세요',
    pick: hasLayers
      ? '선택 요소에서 가져올 픽셀을 짧게 그어주세요'
      : '사진 위를 짧게 그어 픽셀을 선택하세요',
    spray: hasLayers
      ? '선택 요소 뒤로 스프레이하듯 쓸어주세요'
      : '손가락을 움직여 픽셀을 스프레이하세요',
    stretch: hasLayers
      ? '선택 요소 뒤쪽으로 길게 당겨주세요'
      : '선택선에서 원하는 방향으로 길게 당겨주세요',
    hand: '한 손가락으로 이동하고 두 손가락으로 확대하세요',
  };
  el.hint.textContent = hints[state.tool] || '';
}

function setTool(tool) {
  state.tool = tool;
  $$('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  const layerMode = tool === 'layer';
  el.layerControls.classList.toggle('hidden', !layerMode);
  el.effectControls.classList.toggle('hidden', layerMode);
  updateHint();
  drawOverlay();
}

$$('[data-tool]').forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

$$('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    $$('[data-mode]').forEach((item) => item.classList.toggle('active', item === button));
  });
});

function setAIStatus(show, title = '요소 분석 중', text = '처음 한 번은 AI 모델을 준비합니다') {
  el.aiStatusTitle.textContent = title;
  el.aiStatusText.textContent = text;
  el.aiStatus.classList.toggle('hidden', !show);
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const token = ++state.imageToken;
  try {
    const bmp = await createImageBitmap(file);
    if (token !== state.imageToken) {
      bmp.close();
      return;
    }
    const scale = Math.min(1, MAX_IMAGE / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const pad = Math.round(Math.max(width, height) * 0.38);
    const canvasWidth = width + pad * 2;
    const canvasHeight = height + pad * 2;

    [el.image, el.effect, el.foreground, el.overlay].forEach((canvas) => {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    });
    state.sourceCanvas.width = width;
    state.sourceCanvas.height = height;
    const sourceContext = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
    sourceContext.clearRect(0, 0, width, height);
    sourceContext.drawImage(bmp, 0, 0, width, height);
    bmp.close();

    ix.clearRect(0, 0, canvasWidth, canvasHeight);
    ix.drawImage(state.sourceCanvas, pad, pad);
    fx.clearRect(0, 0, canvasWidth, canvasHeight);
    fg.clearRect(0, 0, canvasWidth, canvasHeight);
    ox.clearRect(0, 0, canvasWidth, canvasHeight);

    state.sourceImageData = sourceContext.getImageData(0, 0, width, height);
    state.imageData = ix.getImageData(0, 0, canvasWidth, canvasHeight);
    state.imageRect = { x: pad, y: pad, w: width, h: height };
    state.line = [];
    state.strip = null;
    state.preview = null;
    state.undo = [];
    state.redo = [];
    state.layers = [];
    state.activeLayerId = null;
    state.showMask = false;
    state.layerSequence = 0;
    state.fileName = (file.name || 'image').replace(/\.[^.]+$/, '');

    el.empty.classList.add('hidden');
    el.viewport.classList.remove('hidden');
    el.controls.classList.remove('hidden');
    setTool('layer');
    updateHistory();
    updateLayerUI();
    drawOverlay();
    requestAnimationFrame(fitView);
    say('사진을 불러왔습니다 · 요소를 탭하세요');

    const warm = () => ensureSegmenter().catch(() => null);
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2800 });
    else setTimeout(warm, 1000);
  } catch (error) {
    console.error(error);
    say('사진을 불러오지 못했습니다');
  }
}

[el.first, el.file].forEach((input) => {
  input.addEventListener('change', (event) => {
    loadFile(event.target.files?.[0]);
    event.target.value = '';
  });
});

function fitView() {
  if (!state.imageRect) return;
  const rect = el.viewport.getBoundingClientRect();
  const padding = 14;
  state.scale = Math.max(
    0.05,
    Math.min(7, Math.min((rect.width - padding * 2) / el.effect.width, (rect.height - padding * 2) / el.effect.height)),
  );
  state.tx = (rect.width - el.effect.width * state.scale) / 2;
  state.ty = (rect.height - el.effect.height * state.scale) / 2;
  applyTransform();
}

function applyTransform() {
  el.stage.style.transform = `translate(${state.tx}px,${state.ty}px) scale(${state.scale})`;
}

el.fit.addEventListener('click', fitView);
window.addEventListener('resize', () => state.imageRect && fitView());

function point(clientX, clientY) {
  const rect = el.viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.tx) / state.scale,
    y: (clientY - rect.top - state.ty) / state.scale,
  };
}

function inImage(p) {
  const rect = state.imageRect;
  return Boolean(rect && p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.w && p.y < rect.y + rect.h);
}

function clampToImage(p) {
  const rect = state.imageRect;
  if (!rect) return p;
  return {
    x: Math.max(rect.x, Math.min(rect.x + rect.w - 1, p.x)),
    y: Math.max(rect.y, Math.min(rect.y + rect.h - 1, p.y)),
  };
}

function snapshot() {
  state.undo.push(fx.getImageData(0, 0, el.effect.width, el.effect.height));
  if (state.undo.length > MAX_HISTORY) state.undo.shift();
  state.redo = [];
  updateHistory();
}

function updateHistory() {
  el.undo.disabled = !state.undo.length;
  el.redo.disabled = !state.redo.length;
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(fx.getImageData(0, 0, el.effect.width, el.effect.height));
  fx.putImageData(state.undo.pop(), 0, 0);
  updateHistory();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(fx.getImageData(0, 0, el.effect.width, el.effect.height));
  fx.putImageData(state.redo.pop(), 0, 0);
  updateHistory();
}

el.undo.addEventListener('click', undo);
el.redo.addEventListener('click', redo);

el.clear.addEventListener('click', () => {
  if (!state.imageRect) return;
  snapshot();
  fx.clearRect(0, 0, el.effect.width, el.effect.height);
  say('효과를 지웠습니다');
});

el.reset.addEventListener('click', () => {
  if (!state.imageRect) return;
  fx.clearRect(0, 0, el.effect.width, el.effect.height);
  fg.clearRect(0, 0, el.foreground.width, el.foreground.height);
  state.undo = [];
  state.redo = [];
  state.line = [];
  state.strip = null;
  state.layers = [];
  state.activeLayerId = null;
  state.showMask = false;
  updateHistory();
  updateLayerUI();
  setTool('layer');
  say('레이어와 효과를 모두 초기화했습니다');
});

el.reselect.addEventListener('click', () => {
  state.line = [];
  state.strip = null;
  setTool('pick');
  drawOverlay();
});

el.addLayer.addEventListener('click', () => {
  state.showMask = false;
  setTool('layer');
  say('사진에서 보호할 요소를 탭하세요');
});

el.previewMask.addEventListener('click', () => {
  if (!activeLayer()) return;
  state.showMask = !state.showMask;
  updateLayerUI();
  drawOverlay();
});

