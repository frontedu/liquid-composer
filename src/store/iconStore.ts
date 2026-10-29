import { atom, batch, computed } from 'nanostores';
import { $selectedLayerId, selectLayer, CANVAS_SELECTION_ID } from './uiStore';
import type {
  Layer,
  BackgroundConfig,
  AppearanceMode,
  BlendMode,
  LiquidGlassConfig,
  FillConfig,
  IconDocument,
} from '../types/index';

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function defaultLiquidGlass(): LiquidGlassConfig {
  return {
    enabled: true,          // Liquid Glass on by default
    mode: 'individual',
    specular: true,
    blur: { enabled: false, value: 50 },
    translucency: { enabled: true, value: 50 },
    translucencyGradient: { enabled: false, angle: 90, start: 0, end: 100, startOpacity: 100, endOpacity: 0 },
    dark: { enabled: false, value: 20 },
    mono: { enabled: false, value: 0 },
    shadow: { type: 'neutral', enabled: true, value: 50 },
    aberration: 0,
    specularIntensity: 100,
    refraction: { enabled: false },
    effects: { refraction: 50, bevel: 1.25, frostiness: 0 },
  };
}

export function createLayer(name: string, parentId: string | null = null): Layer {
  return {
    id: generateId(),
    name,
    type: 'layer',
    parentId,
    order: 0,
    visible: true,
    opacity: 100,
    blendMode: 'normal' as BlendMode,
    fill: { type: 'none' },
    liquidGlass: defaultLiquidGlass(),
    layout: { x: 0, y: 0, scale: 80 },
  };
}

export function createGroup(name: string, parentId: string | null = null): Layer {
  return {
    id: generateId(),
    name,
    type: 'group',
    parentId,
    order: 0,
    visible: true,
    collapsed: false,
    opacity: 100,
    blendMode: 'normal' as BlendMode,
    fill: { type: 'none' },
    liquidGlass: defaultLiquidGlass(),
    layout: { x: 0, y: 0, scale: 80 },
  };
}

export function bgColorsFromHueTint(hue: number, tint: number, brightness = 100): [string, string] {
  const bFactor = Math.max(0.05, brightness / 100);
  const t = tint / 100;                                        // 0 = vivid, 1 = pure white/gray
  const s1 = Math.max(0, Math.round(85 * (1 - t)));            // 85 → 0
  const s2 = Math.max(0, Math.round(68 * (1 - t)));            // 68 → 0
  const l1 = Math.min(100, Math.round((48 + tint * 0.52) * bFactor));
  const l2 = Math.min(100, Math.round((61 + tint * 0.39) * bFactor));
  return [`hsl(${hue}, ${s1}%, ${l1}%)`, `hsl(${hue}, ${s2}%, ${l2}%)`];
}

export function automaticGradient(hex: string): [string, string] {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const k = y <= 0.25 ? 0.04 : y <= 0.5 ? 0.08 : y <= 0.75 ? 0.15 : -0.05;
  const shifted = `#${rgb.map((v) => {
    const s = v + 0.2 * (v - y);
    return Math.round(Math.min(1, Math.max(0, s + k * (k < 0 ? s : 1 - s))) * 255).toString(16).padStart(2, '0');
  }).join('')}`;
  return k > 0 ? [shifted, hex] : [hex, shifted];
}

export function defaultBackground(): BackgroundConfig {
  const [top, bottom] = automaticGradient('#0088ff');
  return { type: 'gradient', bgType: 'custom', stops: [{ offset: 0, color: top }, { offset: 1, color: bottom }], angle: 90 };
}

export const $iconName = atom<string>('Untitled');
export const $iconModified = atom<boolean>(false);
export const $layers = atom<Layer[]>([]);
export const $background = atom<BackgroundConfig>(defaultBackground());

export const $flatLayers = computed($layers, (layers) =>
  [...layers].sort((a, b) => a.order - b.order)
);

export const $rootLayers = computed($layers, (layers) =>
  layers.filter((l) => l.parentId === null).sort((a, b) => b.order - a.order)
);

export function addLayer(blobUrl?: string, sourceFile?: string, parentId: string | null = null, scale?: number) {
  const layers = $layers.get();
  const siblings = layers.filter((l) => l.parentId === parentId);
  // New layers appear on TOP: highest order = visually first
  const maxOrder = siblings.length > 0 ? Math.max(...siblings.map((l) => l.order)) : -1;

  const layer = createLayer(sourceFile?.replace(/\.[^.]+$/, '') || `Layer ${layers.length + 1}`, parentId);
  layer.order = maxOrder + 1;
  if (blobUrl) layer.blobUrl = blobUrl;
  if (sourceFile) layer.sourceFile = sourceFile;

  const isRaster = sourceFile && /\.(png|jpe?g|webp)$/i.test(sourceFile);
  layer.layout = { x: 0, y: 0, scale: scale ?? (isRaster ? 100 : 80) };

  batch(() => {
    $layers.set([...layers, layer]);
    $iconModified.set(true);
    selectLayer(layer.id);
  });
  return layer.id;
}

export function addGroup() {
  const layers = $layers.get();
  const rootSiblings = layers.filter((l) => l.parentId === null);
  // New groups appear on TOP: highest order = visually first
  const maxOrder = rootSiblings.length > 0 ? Math.max(...rootSiblings.map((l) => l.order)) : -1;
  const group = createGroup(`Group ${layers.filter((l) => l.type === 'group').length + 1}`);
  group.order = maxOrder + 1;
  batch(() => {
    $layers.set([...layers, group]);
    $iconModified.set(true);
    selectLayer(group.id);
  });
  return group.id;
}

export function removeLayer(id: string) {
  const layers = $layers.get();
  // Propagate removal to all descendants
  const toRemove = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of layers) {
      if (l.parentId && toRemove.has(l.parentId) && !toRemove.has(l.id)) {
        toRemove.add(l.id);
        changed = true;
      }
    }
  }
  $layers.set(layers.filter((l) => !toRemove.has(l.id)));
  $iconModified.set(true);
}

export function updateLayer(id: string, updates: Partial<Layer>) {
  $layers.set(
    $layers.get().map((l) => (l.id === id ? { ...l, ...updates } : l))
  );
  $iconModified.set(true);
}

function mergeLiquidGlass(base: LiquidGlassConfig, lg: Partial<LiquidGlassConfig>): LiquidGlassConfig {
  return { ...base, ...lg, ...(lg.effects && { effects: { ...base.effects, ...lg.effects } }), ...(lg.translucencyGradient && { translucencyGradient: { ...base.translucencyGradient, ...lg.translucencyGradient } as NonNullable<LiquidGlassConfig['translucencyGradient']> }) };
}

export function updateLayerLiquidGlass(id: string, lg: Partial<LiquidGlassConfig>) {
  const layer = $layers.get().find((l) => l.id === id);
  if (layer) updateLayer(id, { liquidGlass: mergeLiquidGlass(layer.liquidGlass, lg) });
}

export function updateAllLayersLiquidGlass(updates: Partial<LiquidGlassConfig>) {
  $layers.set(
    $layers.get().map((l) => ({
      ...l,
      liquidGlass: mergeLiquidGlass(l.liquidGlass, updates),
    }))
  );
  $iconModified.set(true);
}

export function updateLayerFill(id: string, fill: FillConfig) {
  updateLayer(id, { fill });
}

export function moveLayerToGroup(layerId: string, targetGroupId: string | null) {
  const layers = $layers.get();
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return;
  // Put at the end of the new (or root) group
  const maxOrder = layers.filter(l => l.parentId === targetGroupId).length;
  updateLayer(layerId, { parentId: targetGroupId, order: maxOrder });
}

export function toggleLayerVisibility(id: string) {
  const layer = $layers.get().find((l) => l.id === id);
  if (layer) updateLayer(id, { visible: !layer.visible });
}

export function toggleGroupCollapsed(id: string) {
  const layer = $layers.get().find((l) => l.id === id);
  if (layer && layer.type === 'group') {
    updateLayer(id, { collapsed: !layer.collapsed });
  }
}

export function reorderLayer(id: string, targetId: string, position: 'before' | 'after') {
  const layers = $layers.get();
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;

  const siblings = layers
    .filter((l) => l.parentId === layer.parentId)
    .sort((a, b) => b.order - a.order);

  const withoutDragged = siblings.filter((l) => l.id !== id);
  const targetIdx = withoutDragged.findIndex((l) => l.id === targetId);
  if (targetIdx === -1) return;

  if (position === 'before') {
    withoutDragged.splice(targetIdx, 0, layer);
  } else {
    withoutDragged.splice(targetIdx + 1, 0, layer);
  }

  const n = withoutDragged.length;
  const updated = layers.map((l) => {
    const idx = withoutDragged.findIndex((s) => s.id === l.id);
    if (idx !== -1) return { ...l, order: n - 1 - idx };
    return l;
  });
  $layers.set(updated);
  $iconModified.set(true);
}

export function arrangeLayer(id: string, direction: 'forward' | 'backward' | 'front' | 'back') {
  const layers = $layers.get();
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;
  const siblings = layers.filter((l) => l.parentId === layer.parentId).sort((a, b) => b.order - a.order);
  const index = direction === 'front' ? 0
    : direction === 'back' ? siblings.length - 1
    : siblings.indexOf(layer) + (direction === 'forward' ? -1 : 1);
  const target = siblings[index];
  if (target) reorderLayer(id, target.id, direction === 'forward' || direction === 'front' ? 'before' : 'after');
}

export function nudgeLayer(id: string, dx: number, dy: number) {
  $layers.set($layers.get().map((l) => (l.id === id || l.parentId === id) && l.type !== 'group'
    ? { ...l, layout: { ...l.layout, x: l.layout.x + dx, y: l.layout.y + dy } }
    : l));
  $iconModified.set(true);
}

// ── Style clipboard ──
let copiedStyle: Pick<Layer, 'liquidGlass' | 'fill' | 'opacity' | 'blendMode'> | null = null;

export function copyLayerStyle(id: string) {
  const layer = $layers.get().find((l) => l.id === id);
  if (layer) copiedStyle = { liquidGlass: layer.liquidGlass, fill: layer.fill, opacity: layer.opacity, blendMode: layer.blendMode };
}

export function pasteLayerStyle(id: string) {
  if (!copiedStyle || !$layers.get().some((l) => l.id === id)) return false;
  updateLayer(id, copiedStyle);
  return true;
}

export async function duplicateLayer(id: string) {
  const layers = $layers.get();
  const source = layers.find((l) => l.id === id);
  if (!source) return null;
  const ids = new Map<string, string>();
  const collect = (layer: Layer): Layer[] => {
    ids.set(layer.id, generateId());
    return [layer, ...layers.filter((l) => l.parentId === layer.id && !ids.has(l.id)).flatMap(collect)];
  };
  const copies = await Promise.all(collect(source).map(async (layer): Promise<Layer> => ({
    ...structuredClone(layer),
    id: ids.get(layer.id)!,
    parentId: layer.id === id ? layer.parentId : ids.get(layer.parentId!)!,
    blobUrl: layer.blobUrl && URL.createObjectURL(await (await fetch(layer.blobUrl)).blob()),
  })));
  const current = $layers.get();
  const live = current.find((l) => l.id === id);
  if (!live) {
    copies.filter((c) => c.blobUrl).forEach((c) => URL.revokeObjectURL(c.blobUrl!));
    return null;
  }
  const [copy] = copies;
  copy.name = `${live.name} copy`;
  copy.parentId = live.parentId;
  copy.order = live.order + 1;
  batch(() => {
    $layers.set([
      ...current.map((l) => (l.parentId === live.parentId && l.order > live.order ? { ...l, order: l.order + 1 } : l)),
      ...copies,
    ]);
    $iconModified.set(true);
    selectLayer(copy.id);
  });
  return copy.id;
}

// ── Layer clipboard ──
let clipboard: { marker: string; entries: Promise<{ layer: Layer; blob?: Blob }[]> } | null = null;

export function copiedLayerMarker() {
  return clipboard?.marker ?? null;
}

export function copyLayer(id: string) {
  const layers = $layers.get();
  const source = layers.find((l) => l.id === id);
  if (!source) return null;
  const seen = new Set<string>();
  const collect = (layer: Layer): Layer[] => {
    seen.add(layer.id);
    return [layer, ...layers.filter((l) => l.parentId === layer.id && !seen.has(l.id)).flatMap(collect)];
  };
  clipboard = {
    marker: `liquid-composer-layer:${generateId()}`,
    entries: Promise.all(collect(source).map(async (layer) => ({
      layer: structuredClone(layer),
      blob: layer.blobUrl ? await (await fetch(layer.blobUrl)).blob() : undefined,
    }))),
  };
  return clipboard.marker;
}

export function cutLayer(id: string) {
  const marker = copyLayer(id);
  if (marker) removeLayer(id);
  return marker;
}

export async function pasteLayers() {
  if (!clipboard) return null;
  const entries = await clipboard.entries;
  const layers = $layers.get();
  const selected = layers.find((l) => l.id === $selectedLayerId.get());
  const parentId = entries[0].layer.type === 'group' ? null : selected?.parentId ?? null;
  const anchor = selected && (selected.parentId === parentId ? selected : layers.find((l) => l.id === selected.parentId));
  const ids = new Map(entries.map(({ layer }) => [layer.id, generateId()]));
  const copies = entries.map(({ layer, blob }, i): Layer => ({
    ...structuredClone(layer),
    id: ids.get(layer.id)!,
    parentId: i === 0 ? parentId : ids.get(layer.parentId!)!,
    blobUrl: blob && URL.createObjectURL(blob),
  }));
  const [copy] = copies;
  const siblings = layers.filter((l) => l.parentId === parentId);
  copy.order = anchor ? anchor.order + 1 : Math.max(-1, ...siblings.map((l) => l.order)) + 1;
  batch(() => {
    $layers.set([
      ...layers.map((l) => (anchor && l.parentId === parentId && l.order > anchor.order ? { ...l, order: l.order + 1 } : l)),
      ...copies,
    ]);
    $iconModified.set(true);
    selectLayer(copy.id);
  });
  return copy.id;
}

export function setIconName(name: string) {
  $iconName.set(name.trim() || 'Untitled');
  $iconModified.set(true);
}

export function updateBackground(bg: Partial<BackgroundConfig>) {
  $background.set({ ...$background.get(), ...bg } as BackgroundConfig);
  $iconModified.set(true);
}

export function resetDocument() {
  batch(() => {
    $iconName.set('Untitled');
    $iconModified.set(false);
    $layers.set([]);
    $background.set(defaultBackground());
  });
  clearHistory();
}

export function loadDocument(doc: Pick<IconDocument, 'name' | 'layers' | 'background'>) {
  $layers.get().filter((l) => l.blobUrl).forEach((l) => URL.revokeObjectURL(l.blobUrl!));
  batch(() => {
    $iconName.set(doc.name.trim() || 'Untitled');
    $layers.set(doc.layers);
    $background.set(doc.background);
    $iconModified.set(true);
    selectLayer(null);
  });
  clearHistory();
}

// ── History ──
type DocumentState = { layers: Layer[]; background: BackgroundConfig; name: string };

const HISTORY_LIMIT = 100;
const HISTORY_COALESCE_MS = 500;
const undoStack: DocumentState[] = [];
const redoStack: DocumentState[] = [];
const historyUrls = new Set<string>();
let present = documentState();
let pending: DocumentState | null = null;
let pendingGesture = false;
let historyGesture = false;
let applying = false;
let lastKey: string | null = null;
let lastTime = 0;

function documentState(): DocumentState {
  return { layers: $layers.get(), background: $background.get(), name: $iconName.get() };
}

function changeKey(a: DocumentState, b: DocumentState): string | null {
  if (a.name !== b.name) return 'name';
  if (a.background !== b.background) return 'background';
  if (a.layers.length !== b.layers.length) return null;
  const keys: string[] = [];
  for (let i = 0; i < b.layers.length; i++) {
    const before = a.layers[i];
    const after = b.layers[i];
    if (before.id !== after.id) return null;
    for (const k of Object.keys(after) as (keyof Layer)[]) {
      if (k !== 'collapsed' && before[k] !== after[k]) keys.push(`${after.id}.${k}`);
    }
  }
  return keys.join();
}

function releaseUrls() {
  const live = new Set<string>();
  for (const state of [present, ...undoStack, ...redoStack]) {
    for (const l of state.layers) if (l.blobUrl) live.add(l.blobUrl);
  }
  historyUrls.forEach((url) => {
    if (live.has(url)) return;
    URL.revokeObjectURL(url);
    historyUrls.delete(url);
  });
  live.forEach((url) => historyUrls.add(url));
}

function commitHistory() {
  const before = pending;
  pending = null;
  if (!before || !$iconModified.get()) return;
  const key = changeKey(before, present);
  if (key === '') return;
  const now = performance.now();
  if (key === null || key !== lastKey || !(pendingGesture || now - lastTime < HISTORY_COALESCE_MS)) {
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  redoStack.length = 0;
  lastKey = key;
  lastTime = now;
  releaseUrls();
}

function trackHistory() {
  if (applying) return;
  if (!pending) {
    pending = present;
    pendingGesture = historyGesture;
    queueMicrotask(commitHistory);
  }
  present = documentState();
}

$layers.listen(trackHistory);
$background.listen(trackHistory);
$iconName.listen(trackHistory);

export function setHistoryGesture(active: boolean) {
  historyGesture = active;
}

function applyHistory(state: DocumentState) {
  applying = true;
  batch(() => {
    $layers.set(state.layers);
    $background.set(state.background);
    $iconName.set(state.name);
    $iconModified.set(true);
  });
  applying = false;
  present = state;
  lastKey = null;
  const selected = $selectedLayerId.get();
  if (selected && selected !== CANVAS_SELECTION_ID && !state.layers.some((l) => l.id === selected)) selectLayer(null);
}

export function undo() {
  commitHistory();
  const state = undoStack.pop();
  if (!state) return false;
  redoStack.push(present);
  applyHistory(state);
  return true;
}

export function redo() {
  commitHistory();
  const state = redoStack.pop();
  if (!state) return false;
  undoStack.push(present);
  applyHistory(state);
  return true;
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  pending = null;
  present = documentState();
  lastKey = null;
  releaseUrls();
}
