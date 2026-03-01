import { atom, computed } from 'nanostores';
import { selectLayer } from './uiStore';
import type {
  Layer,
  BackgroundConfig,
  AppearanceMode,
  BlendMode,
  LiquidGlassConfig,
  FillConfig,
} from '../types/index';

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function defaultLiquidGlass(): LiquidGlassConfig {
  return {
    enabled: true,          // Liquid Glass on by default
    mode: 'individual',
    specular: true,
    blur: { enabled: false, value: 0 },
    translucency: { enabled: true, value: 10 },
    dark: { enabled: false, value: 20 },
    mono: { enabled: false, value: 0 },
    shadow: { type: 'chromatic', enabled: true, value: 30 },
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
  // Lightness scales so that tint=100 + brightness=100 → l=100% (pure white)
  const l1 = Math.min(100, Math.round((48 + tint * 0.52) * bFactor));
  const l2 = Math.min(100, Math.round((61 + tint * 0.39) * bFactor));
  return [`hsl(${hue}, ${s1}%, ${l1}%)`, `hsl(${hue}, ${s2}%, ${l2}%)`];
}

export const $iconName = atom<string>('Untitled');
export const $iconModified = atom<boolean>(false);
export const $layers = atom<Layer[]>([]);
export const $background = atom<BackgroundConfig>({
  type: 'gradient',
  hue: 220,
  tint: 20,
  colors: bgColorsFromHueTint(220, 20),
  angle: 135,
});

export const $flatLayers = computed($layers, (layers) =>
  [...layers].sort((a, b) => a.order - b.order)
);

export const $rootLayers = computed($layers, (layers) =>
  layers.filter((l) => l.parentId === null).sort((a, b) => b.order - a.order)
);

export function addLayer(blobUrl?: string, sourceFile?: string, parentId: string | null = null) {
  const layers = $layers.get();
  const siblings = layers.filter((l) => l.parentId === parentId);
  // New layers appear on TOP: highest order = visually first
  const maxOrder = siblings.length > 0 ? Math.max(...siblings.map((l) => l.order)) : -1;

  const layer = createLayer(sourceFile ?? `Layer ${layers.length + 1}`, parentId);
  layer.order = maxOrder + 1;
  if (blobUrl) layer.blobUrl = blobUrl;
  if (sourceFile) layer.sourceFile = sourceFile;

  // Raster images: disable glass by default (no clean alpha silhouette) + scale 100%
  const isRaster = sourceFile && /\.(png|jpe?g|webp)$/i.test(sourceFile);
  if (isRaster) {
    layer.liquidGlass = { ...layer.liquidGlass, enabled: false };
    layer.layout = { x: 0, y: 0, scale: 100 };
  }

  $layers.set([...layers, layer]);
  $iconModified.set(true);
  selectLayer(layer.id);
  return layer.id;
}

export function addGroup() {
  const layers = $layers.get();
  const rootSiblings = layers.filter((l) => l.parentId === null);
  // New groups appear on TOP: highest order = visually first
  const maxOrder = rootSiblings.length > 0 ? Math.max(...rootSiblings.map((l) => l.order)) : -1;
  const group = createGroup(`Group ${layers.filter((l) => l.type === 'group').length + 1}`);
  group.order = maxOrder + 1;
  $layers.set([...layers, group]);
  $iconModified.set(true);
  selectLayer(group.id);
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
  // Revoke blob URLs to free memory
  layers.filter((l) => toRemove.has(l.id) && l.blobUrl).forEach((l) => URL.revokeObjectURL(l.blobUrl!));
  $layers.set(layers.filter((l) => !toRemove.has(l.id)));
  $iconModified.set(true);
}

export function updateLayer(id: string, updates: Partial<Layer>) {
  $layers.set(
    $layers.get().map((l) => (l.id === id ? { ...l, ...updates } : l))
  );
  $iconModified.set(true);
}

export function updateLayerLiquidGlass(id: string, lg: Partial<LiquidGlassConfig>) {
  const layer = $layers.get().find((l) => l.id === id);
  if (layer) updateLayer(id, { liquidGlass: { ...layer.liquidGlass, ...lg } });
}

export function updateAllLayersLiquidGlass(updates: Partial<LiquidGlassConfig>) {
  $layers.set(
    $layers.get().map((l) => ({
      ...l,
      liquidGlass: { ...l.liquidGlass, ...updates }
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

  // Visual order: descending (highest order = top of list = index 0)
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

  // Reassign dense orders: top item gets highest, bottom gets 0
  const n = withoutDragged.length;
  const updated = layers.map((l) => {
    const idx = withoutDragged.findIndex((s) => s.id === l.id);
    if (idx !== -1) return { ...l, order: n - 1 - idx };
    return l;
  });
  $layers.set(updated);
  $iconModified.set(true);
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
  $iconName.set('Untitled');
  $iconModified.set(false);
  $layers.set([]);
  $background.set({ type: 'gradient', hue: 220, tint: 20, colors: bgColorsFromHueTint(220, 20), angle: 135 });
}
