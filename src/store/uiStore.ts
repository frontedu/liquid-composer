import { atom } from 'nanostores';
import type { AppearanceMode } from '../types/index';

export const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200] as const;

export const LIGHT_ANGLE_LEVELS = [90, 45, 0, 315, 270, 225, 180, 135] as const;
export type LightAngleLevel = typeof LIGHT_ANGLE_LEVELS[number];

export const LIGHT_ANGLE_LABELS: Record<number, string> = {
   '90': 'Top',
   '45': 'Top Right',
    '0': 'Right',
  '315': 'Bottom Right',
  '270': 'Bottom',
  '225': 'Bottom Left',
  '180': 'Left',
  '135': 'Top Left',
};

export const $selectedLayerId = atom<string | null>(null);
export const $appearanceMode = atom<AppearanceMode>('default');
export const $lightAngle = atom<number>(135);
export const $zoom = atom<number>(100);
export const $inspectorTab = atom<'brush' | 'document'>('brush');
export const $isDragOver = atom<boolean>(false);
export const $showBackgroundPicker = atom<boolean>(false);
export type Webgl2Status = 'inactive' | 'active' | 'error';
export const $webgl2Status = atom<Webgl2Status>('inactive');
export const $webgl2Error = atom<string>('');

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

export function setWebgl2Status(status: Webgl2Status) {
  $webgl2Status.set(status);
  if (status !== 'error') $webgl2Error.set('');
}

export function setWebgl2Error(message: string) {
  $webgl2Error.set(message);
  $webgl2Status.set('error');
}

export function setWebgl2Active(active: boolean) {
  setWebgl2Status(active ? 'active' : 'inactive');
}
