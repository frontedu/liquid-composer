// ── Official tables (Icon Composer 27.2) ──

export interface HighlightSpec {
  distance: number;      // units of 1/1024
  minPx: number;
  spreadDeg: number;
  bias: number;
  curvature: number;
  angleFromKey: number;  // rad
  opacity: number;
  outsetOpacity?: number;
  dark: boolean;
}

export const GLYPH_HIGHLIGHTS: readonly HighlightSpec[] = [
  { distance: 4,  minPx: 1, spreadDeg: 90, bias: 0.5,  curvature: 0.75, angleFromKey: 0,            opacity: 1, dark: false },
  { distance: 16, minPx: 4, spreadDeg: 60, bias: 0.08, curvature: 1,    angleFromKey: 0,            opacity: 1, dark: false },
  { distance: 4,  minPx: 1, spreadDeg: 60, bias: 0.5,  curvature: 0.75, angleFromKey: Math.PI,      opacity: 1, dark: false },
  { distance: 16, minPx: 4, spreadDeg: 60, bias: 0.08, curvature: 1,    angleFromKey: Math.PI,      opacity: 1, dark: false },
  { distance: 4,  minPx: 1, spreadDeg: 90, bias: 0.2,  curvature: 0.75, angleFromKey: Math.PI / 2,  opacity: 1, outsetOpacity: 0.9, dark: true },
  { distance: 4,  minPx: 1, spreadDeg: 90, bias: 0.2,  curvature: 0.75, angleFromKey: -Math.PI / 2, opacity: 1, outsetOpacity: 0.9, dark: true },
];

export const CHICLET_LIGHT_LONGITUDE = 0; // rad, 0 = top
export const CHICLET_HIGHLIGHTS = [
  { distance: 10, spreadDeg: 120, bias: 0.5,  angleFromKey: 0,            opacity: 0.2,  dark: false },
  { distance: 40, spreadDeg: 90,  bias: 0.08, angleFromKey: 0,            opacity: 0.5,  dark: false },
  { distance: 10, spreadDeg: 120, bias: 0.5,  angleFromKey: Math.PI,      opacity: 0.2,  dark: false },
  { distance: 40, spreadDeg: 90,  bias: 0.08, angleFromKey: Math.PI,      opacity: 0.25, dark: false },
  { distance: 10, spreadDeg: 60,  bias: 0.5,  angleFromKey: Math.PI / 2,  opacity: 0.2,  dark: true },
  { distance: 10, spreadDeg: 60,  bias: 0.5,  angleFromKey: -Math.PI / 2, opacity: 0.2,  dark: true },
] as const;
export const CHICLET_CLEAR_HIGHLIGHTS = [
  { distance: 10, spreadDeg: 100, bias: 0.5, angleFromKey: 0,            opacity: 1.25, dark: false },
  { distance: 44, spreadDeg: 45,  bias: 0.5, angleFromKey: 0,            opacity: 0.5,  dark: false },
  { distance: 9,  spreadDeg: 65,  bias: 0.5, angleFromKey: Math.PI / 2,  opacity: 0.25, dark: true },
  { distance: 9,  spreadDeg: 65,  bias: 0.5, angleFromKey: -Math.PI / 2, opacity: 0.25, dark: true },
] as const;
export const CHICLET_LUMINANCE = { maxDim: 0.2, minBright: 0.99 } as const; // Y709
export const CHICLET_SHADOW = { opacity: 0.25, radius: 20, offsetY: 10 } as const; // units of 1/1024, editor only

export interface Vcm { black: number; white: number; sat: number }

export const HIGHLIGHT_VCM: Vcm = { black: 0.2, white: 1.2, sat: 1.25 };
export const DARKLIGHT_VCM: Vcm = { black: -0.15, white: 0.7, sat: 1.25 };

export const CLEAR_MODE = {
  contentLightening: 0.85, lightening: 1, darkening: 0.3, highlights: 1,
  lighteningVCM: { black: 0.9, white: 2.5, sat: 2 }, highlightsVCM: { black: 0.2, white: 1.35, sat: 1.4 },
} as const;
export const MITIGATED = { clearLight: 0.5, clearDark: 0.17 } as const; // linear gray of the flat chiclet

export const MATERIAL = { blurMax: 64, heightMin: 12.8, heightRange: 243.2, strengthMax: 640 } as const; // units of 1/1024
export const LAYER_SHADOW = {
  offsetY: 32, ringWidth: 16, radius: 0.3, neutralOpacity: 0.375, vibrantOpacity: 0.75, vibrantBrightness: 0.75,
  maxOverdraw: { neutral: 0.2, vibrant: 0.5 }, translucencyForMaxOverdraw: 0.3,
} as const;
export const SYSTEM_GRADIENT = { dark: ['#1F1F1F', '#0F0F0F'], light: ['#FFFFFF', '#F5F5F5'] } as const;
export const CHICLET_CORNER_RADIUS = 0.26; // × size

// ── Renderer API ──

export type DarklightPlacement = 'off' | 'inside' | 'outside';

export interface LiquidGlassParams {
  darkMode: boolean;            // appearance === 'dark' only
  blurRadiusPx: number;         // render px, 0 = off
  frostiness: number;           // 0..1
  translucency: number;         // T 0..1
  translucencyGradient?: { enabled: boolean; angle: number; start: number; end: number; startOpacity: number; endOpacity: number };
  layerBounds: [number, number, number, number]; // x0, y0, w, h in UV, y down
  refractionStrengthPx: number; // signed render px, 0 = off
  refractionHeightPx: number;   // render px
  aberration: number;           // 0..1
  lightAngle: number;           // deg, 0 = right, CCW
  placement: DarklightPlacement;
  lightIntensity: number;       // 0..1
  keyGain: number;              // 0..1
  fillGain: number;             // 0..1
  darkGain: number;             // 0..1
  useVCM: boolean;
  lightingBlurPx: number;       // lightingMask sigma, render px
  shadowAlpha?: number;         // own shadow over the glass background, 0 = none
  overdrawAlpha?: number;       // own shadow over the content, before highlights
  clearMask?: number;           // Clear mask output, R = clearMask × luma, G = 1, B = 0; absent = color
}

export interface GlassRenderer {
  readonly canvas: HTMLCanvasElement;
  render(layer: TexImageSource, lighting: TexImageSource, bg: TexImageSource, params: LiquidGlassParams, bgKey?: string, shadow?: TexImageSource): void;
  dispose(): void;
}
