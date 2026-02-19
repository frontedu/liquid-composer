import { atom, computed } from 'nanostores';
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
    enabled: false,
    mode: 'individual',
    specular: true,
    blur: { enabled: true, value: 40 },
    translucency: { enabled: true, value: 60 },
    dark: { enabled: false, value: 20 },
    mono: { enabled: false, value: 0 },
    shadow: { type: 'neutral', enabled: true, value: 30 },
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
    layout: { x: 0, y: 0, scale: 100 },
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
    layout: { x: 0, y: 0, scale: 100 },
  };
}

export const $iconName = atom<string>('Untitled');
export const $iconModified = atom<boolean>(false);
export const $layers = atom<Layer[]>([]);
export const $background = atom<BackgroundConfig>({
  type: 'gradient',
  preset: 'warm',
  colors: ['#ff6b6b', '#ffd93d'],
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
  const maxOrder = layers.filter((l) => l.parentId === parentId).length;
  const layer = createLayer(sourceFile ?? `Layer ${layers.length + 1}`, parentId);
  layer.order = maxOrder;
  if (blobUrl) layer.blobUrl = blobUrl;
  if (sourceFile) layer.sourceFile = sourceFile;
  $layers.set([...layers, layer]);
  $iconModified.set(true);
  return layer.id;
}

export function addGroup() {
  const layers = $layers.get();
  const maxOrder = layers.filter((l) => l.parentId === null).length;
  const group = createGroup(`Group ${layers.filter((l) => l.type === 'group').length + 1}`);
  group.order = maxOrder;
  $layers.set([...layers, group]);
  $iconModified.set(true);
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

export function updateLayerLiquidGlass(id: string, updates: Partial<LiquidGlassConfig>) {
  $layers.set(
    $layers.get().map((l) =>
      l.id === id
        ? { ...l, liquidGlass: { ...l.liquidGlass, ...updates } }
        : l
    )
  );
  $iconModified.set(true);
}

export function updateLayerFill(id: string, fill: FillConfig) {
  updateLayer(id, { fill });
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

export function reorderLayer(id: string, newOrder: number) {
  const layers = $layers.get();
  const layer = layers.find((l) => l.id === id);
  if (!layer) return;

  const siblings = layers
    .filter((l) => l.parentId === layer.parentId && l.id !== id)
    .sort((a, b) => a.order - b.order);

  siblings.splice(newOrder, 0, layer);
  const updated = layers.map((l) => {
    const idx = siblings.findIndex((s) => s.id === l.id);
    if (idx !== -1) return { ...l, order: idx };
    return l;
  });
  $layers.set(updated);
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
  $background.set({ type: 'gradient', preset: 'warm', colors: ['#ff6b6b', '#ffd93d'], angle: 135 });
}
