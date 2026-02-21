import { atom } from 'nanostores';
import type { AppearanceMode } from '../types/index';

export const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200] as const;

export const $selectedLayerId = atom<string | null>(null);
export const $appearanceMode = atom<AppearanceMode>('default');
export const $lightAngle = atom<number>(-45);
export const $zoom = atom<number>(50);
export const $inspectorTab = atom<'brush' | 'document'>('brush');
export const $isDragOver = atom<boolean>(false);
export const $showBackgroundPicker = atom<boolean>(false);

export function selectLayer(id: string | null) {
  $selectedLayerId.set(id);
}

export function setAppearanceMode(mode: AppearanceMode) {
  $appearanceMode.set(mode);
}

export function setLightAngle(angle: number) {
  $lightAngle.set(angle);
}

export function setZoom(zoom: number) {
  $zoom.set(Math.min(200, Math.max(10, zoom)));
}

// Step to the next (direction > 0) or previous (direction < 0) zoom level
export function stepZoom(direction: number) {
  const current = $zoom.get();
  if (direction > 0) {
    const next = ZOOM_LEVELS.find((z) => z > current);
    if (next !== undefined) $zoom.set(next);
  } else {
    const prev = [...ZOOM_LEVELS].reverse().find((z) => z < current);
    if (prev !== undefined) $zoom.set(prev);
  }
}
