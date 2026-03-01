import type { RenderContext, Layer, BackgroundConfig, AppearanceMode } from '../types/index';
import type { LiquidGlassConfig } from '../types/index';
import { drawSquirclePath, createBackgroundCanvas } from './ImageProcessor';
import { LiquidGlassRenderer } from './LiquidGlass';
import type { LiquidGlassParams } from './LiquidGlass';
import { setWebgl2Status, setWebgl2Error } from '../store/uiStore';

// [1] INNER SPECULAR DOME — soft light filling the layer interior on the lit side
const LAYER_DOME_INTENSITY        = 0.50;  // overall strength
const LAYER_DOME_CENTER_ALPHA     = 0.18;  // brightness at the brightest point
const LAYER_DOME_MID_ALPHA        = 0.09;  // brightness halfway across
const LAYER_DOME_EDGE_ALPHA       = 0.05;  // brightness near the edge before fading out
const LAYER_DOME_RADIUS           = 0.80;  // dome coverage (× size, 0–1)
const LAYER_DOME_BLUR_BASE        = 0.014; // softness — higher = more diffuse (× size)

// [2] INNER COLORED RIM — thin ring inside the layer edge, tinted with the layer color
// Wraps all the way around: brighter on lit side, softer on shadow side.
const LAYER_INNER_RIM_WIDTH       = 0.026; // rim thickness (× size)
const LAYER_INNER_RIM_LIT_ALPHA   = 0.65;  // intensity on lit side
const LAYER_INNER_RIM_MID_ALPHA   = 0.50;  // intensity in the middle
const LAYER_INNER_RIM_SHADOW_ALPHA= 0.22;  // intensity on shadow side (0 = disappears)
const LAYER_INNER_RIM_BLUR        = 0.0015;// softness (× size) — keep small for sharp edge
const LAYER_INNER_RIM_ALPHA_BLUR  = 0.80;  // opacity of the blurred pass
const LAYER_INNER_RIM_ALPHA_SHARP = 0.45;  // opacity of the sharp pass layered on top
// Same rim applied to interior transparent holes (e.g. ⌘ cutouts)
const LAYER_HOLES_RIM_ALPHA_BLUR  = 0.80;
const LAYER_HOLES_RIM_ALPHA_SHARP = 0.45;

// [4] INNER SHADOW — darkens the inner edge on the shadow side (concave depth)
const LAYER_INNER_SHADOW_WIDTH       = 0.016; // shadow band thickness (× size)
const LAYER_INNER_SHADOW_DARK_ALPHA  = 0.30;  // darkest point
const LAYER_INNER_SHADOW_MID_ALPHA   = 0.12;  // midpoint
const LAYER_INNER_SHADOW_BLUR        = 0.003;  // softness (× size)
const LAYER_INNER_SHADOW_ALPHA_BLUR  = 0.80;  // opacity of blurred pass
const LAYER_INNER_SHADOW_ALPHA_SHARP = 0.30;  // opacity of sharp pass

// [5] OUTER BORDER — thin ring outside the layer shape, colored with the layer's own color
const LAYER_OUTER_BORDER_WIDTH    = 0.002; // border thickness (× size)
const LAYER_OUTER_BORDER_ALPHA    = 0.55;  // border opacity

// [6] SPECULAR HIGHLIGHT — white radial glow clipped to the lit edge of the layer
// Only visible on the lit corner. Radius controls how far it spreads inward.
const LAYER_SPECULAR_RADIUS       = 0.24;  // spread from lit corner (× size)
const LAYER_SPECULAR_PEAK_ALPHA   = 0.40;  // brightness at the center

// [7] FRESNEL RIM — white gradient across the whole layer (lit → shadow)
// Subtle overall sheen that simulates light grazing the glass surface.
const LAYER_FRESNEL_LIT_ALPHA     = 0.18;  // brightness on lit side
const LAYER_FRESNEL_MID_ALPHA     = 0.05;  // brightness in the middle
const LAYER_FRESNEL_SHADOW_ALPHA  = 0.02;  // brightness on shadow side

// [8] INSET TOP HIGHLIGHT — 1px white line at the very top edge of the layer
// Simulates the top bevel of a physical button catching overhead light.
const LAYER_INSET_ALPHA           = 0.22;  // line brightness

// [9] EDGE INNER GLOW — warm/cool luminous band just inside the layer edges
// Color is warm (light mode) or cool blue (dark mode).
const LAYER_INNER_GLOW_WIDTH      = 0.015; // glow band width (× size)
const LAYER_INNER_GLOW_LIT_ALPHA  = 0.35;  // brightness at the lit corner
const LAYER_INNER_GLOW_MID_ALPHA  = 0.15;  // brightness midway
const LAYER_INNER_GLOW_EDGE_ALPHA = 0.04;  // brightness near shadow edge

// [10] SHADOW SIDE DIMMING — darkens the shadow half of the layer content
// Increases perceived curvature/depth.
const LAYER_DIM_SHADOW_ALPHA      = 0.12;  // max darkening on shadow side (scales with translucency)

// [11] DIRECTIONAL INNER SHADOW — dark gradient inside layer on the shadow side
// Heavier in dark mode. Adds the deepest concave shadow feel.
const LAYER_DIR_SHADOW_MID_LIGHT  = 0.06;  // midpoint darkness in light mode
const LAYER_DIR_SHADOW_MAX_LIGHT  = 0.18;  // max darkness in light mode
const LAYER_DIR_SHADOW_MID_DARK   = 0.78;  // midpoint darkness in dark mode
const LAYER_DIR_SHADOW_MAX_DARK   = 0.15;  // max darkness in dark mode

// =============================================================================

// ─── Image cache ──────────────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();

// ─── Hi-res image cache ───────────────────────────────────────────────────────
// SVGs with explicit small intrinsic dims (e.g. 24×24) are rasterized by Chrome
// at that size and upscaled. Loading the same URL into a new Image with explicit
// large width/height forces Chrome to rasterize the SVG at that size instead.
// We preload this once (fire-and-forget) so the render path stays fully synchronous.
const HI_RES_SIZE = 2048;
const hiResImgCache = new Map<string, HTMLImageElement>();

function preloadHiRes(url: string): void {
  if (hiResImgCache.has(url)) return;
  const hi = new Image(HI_RES_SIZE, HI_RES_SIZE);
  hi.crossOrigin = 'anonymous';
  hi.onload = () => hiResImgCache.set(url, hi);
  hi.src = url;
}

// ─── Background canvas cache ──────────────────────────────────────────────────
// Avoids re-creating the background canvas every render when bg config hasn't changed.

const bgCanvasCache = new Map<string, { canvas: HTMLCanvasElement; key: string }>();

// ─── Drop-shadow canvas cache ─────────────────────────────────────────────────
// Caches blurred shadow canvases per layer so we don't re-run filter:blur()
// on every frame when nothing about the shadow has changed.
const shadowCache = new Map<string, { canvas: HTMLCanvasElement; key: string }>();

function getCachedShadow(
  layerId: string,
  contentCanvas: HTMLCanvasElement,
  size: number,
  sv: number,
  fillR: number,
  fillG: number,
  fillB: number,
  shadowAlpha: number,
  blurPx: number,
  offsetY: number,
  layoutX: number,
  layoutY: number,
  layoutScale: number,
  opacity: number,
): HTMLCanvasElement {
  // Key must include layout so moving/scaling a layer invalidates the cache
  const key = `${size}:${sv.toFixed(3)}:${fillR}:${fillG}:${fillB}:${layoutX.toFixed(2)}:${layoutY.toFixed(2)}:${layoutScale.toFixed(2)}:${opacity}`;
  const cached = shadowCache.get(layerId);
  if (cached && cached.key === key) return cached.canvas;

  const canvas = cached?.canvas ?? document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const sc = canvas.getContext('2d')!;
  sc.clearRect(0, 0, size, size);
  sc.save();
  sc.filter = `blur(${blurPx}px)`;
  sc.globalAlpha = shadowAlpha;
  sc.drawImage(contentCanvas, 0, offsetY);
  sc.restore();
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = `rgb(${fillR}, ${fillG}, ${fillB})`;
  sc.fillRect(0, 0, size, size);

  shadowCache.set(layerId, { canvas, key });
  // Evict beyond 16 entries to avoid unbounded growth
  if (shadowCache.size > 16) {
    shadowCache.delete(shadowCache.keys().next().value!);
  }
  return canvas;
}

// ─── Shared tiny canvas for color sampling (avoids per-render allocation) ────
const _colorSampleCanvas = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  (c as any)._ctx = null; // lazy init
  return c;
})();

// ─── Layer tint color cache ───────────────────────────────────────────────────
// The dominant tinted color of a layer only changes when blobUrl or fill changes,
// not when the layer moves. Cache it to avoid getImageData on every frame.
const layerTintCache = new Map<string, { r: number; g: number; b: number }>();

function getCachedBgCanvas(bg: BackgroundConfig, size: number): { canvas: HTMLCanvasElement; key: string } {
  const key = `${size}:${JSON.stringify(bg)}`;
  const cached = bgCanvasCache.get(key);
  if (cached) return cached;
  const canvas = createBackgroundCanvas(bg as any, size, size);
  const entry = { canvas, key };
  bgCanvasCache.set(key, entry);
  // Evict oldest entries beyond 8 to avoid unbounded growth
  if (bgCanvasCache.size > 8) {
    bgCanvasCache.delete(bgCanvasCache.keys().next().value!);
  }
  return entry;
}

async function getCachedImage(url: string): Promise<HTMLImageElement> {
  if (imageCache.has(url)) return imageCache.get(url)!;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      if (img.naturalWidth <= 512 || img.naturalHeight <= 512) preloadHiRes(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── WebGL singleton ──────────────────────────────────────────────────────────

let _glCanvas: HTMLCanvasElement | null = null;
let _glRenderer: LiquidGlassRenderer | null = null;
let _glSize = 0;
let _lastWebglError = '';

type ScratchCanvas = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
type ScratchPool = {
  getCanvas: (key: string, size: number) => ScratchCanvas;
  getImageData: (key: string, size: number) => ImageData;
};

function resetScratch(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.clearRect(0, 0, size, size);
}

function createScratchPool(): ScratchPool {
  const canvases = new Map<string, ScratchCanvas>();
  const imageData = new Map<string, ImageData>();

  return {
    getCanvas(key: string, size: number): ScratchCanvas {
      let entry = canvases.get(key);
      if (!entry) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Unable to create 2D context.');
        entry = { canvas, ctx };
        canvases.set(key, entry);
      }

      if (entry.canvas.width !== size || entry.canvas.height !== size) {
        entry.canvas.width = size;
        entry.canvas.height = size;
      } else {
        resetScratch(entry.ctx, size);
      }

      return entry;
    },
    getImageData(key: string, size: number): ImageData {
      const dataKey = `${key}:${size}`;
      let data = imageData.get(dataKey);
      if (!data) {
        data = new ImageData(size, size);
        imageData.set(dataKey, data);
      } else {
        data.data.fill(0);
      }
      return data;
    },
  };
}

function reportWebglError(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const short = raw.split('\n')[0].slice(0, 180);
  setWebgl2Error(short || 'Unknown WebGL2 error');
  if (raw && raw !== _lastWebglError) {
    // Only log when the error changes to avoid spamming the console.
    console.error('WebGL2 error:', raw);
    _lastWebglError = raw;
  }
}

function getWebGLRenderer(size: number): LiquidGlassRenderer | null {
  try {
    if (!_glCanvas) _glCanvas = document.createElement('canvas');
    // Recreate renderer if size changed (FBOs must match canvas size)
    if (size !== _glSize) {
      _glRenderer?.dispose();
      _glRenderer = null;
      _glCanvas.width = size;
      _glCanvas.height = size;
      _glSize = size;
    }
    if (!_glRenderer) _glRenderer = new LiquidGlassRenderer(_glCanvas);
    return _glRenderer;
  } catch (err) {
    reportWebglError(err);
    return null;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

type ScratchRef = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

const scratchPool = new Map<string, ScratchRef>();

function getScratchCanvas(key: string, width: number, height = width): ScratchRef {
  let entry = scratchPool.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    entry = { canvas, ctx };
    scratchPool.set(key, entry);
  }
  const { canvas, ctx } = entry;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  return entry;
}

function blendModeToCanvas(mode: string): GlobalCompositeOperation {
  const map: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over', multiply: 'multiply', screen: 'screen',
    overlay: 'overlay', darken: 'darken', lighten: 'lighten',
    'color-dodge': 'color-dodge', 'color-burn': 'color-burn',
    'hard-light': 'hard-light', 'soft-light': 'soft-light',
    difference: 'difference', exclusion: 'exclusion',
    hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  };
  return map[mode] ?? 'source-over';
}

function isDarkMode(mode: AppearanceMode): boolean {
  return mode === 'dark';
}

function mapTranslucency(value: number, enabled: boolean, fallback: number): number {
  const t = enabled ? value / 100 : fallback;
  const clamped = Math.max(0, Math.min(1, t));
  return enabled ? Math.pow(clamped, 1.35) : clamped;
}

function collectRenderableLayers(layers: Layer[], parentId: string | null): Layer[] {
  const items = layers
    .filter((l) => l.parentId === parentId && l.visible)
    .sort((a, b) => a.order - b.order);

  const result: Layer[] = [];
  for (const item of items) {
    if (item.type === 'group') {
      result.push(...collectRenderableLayers(layers, item.id));
    } else {
      result.push(item);
    }
  }
  return result;
}

function findSpecularLayerId(layers: Layer[]): string | null {
  const ordered = collectRenderableLayers(layers, null);
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (ordered[i].liquidGlass?.enabled) return ordered[i].id;
  }
  return null;
}

function normalizeHexColor(hex: string): string | null {
  if (!hex) return null;
  if (!hex.startsWith('#')) return null;
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (hex.length === 7) return hex.toLowerCase();
  return null;
}

/**
 * Returns the relative luminance (0–1) of a hex color.
 * Used to decide whether a fill color already contrasts on a dark background.
 */
function relativeLuminance(hex: string): number {
  const parse = (s: string) => parseInt(s, 16) / 255;
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = toLinear(parse(hex.slice(1, 3)));
  const g = toLinear(parse(hex.slice(3, 5)));
  const b = toLinear(parse(hex.slice(5, 7)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * True if the hex color is too dark to be visible on a dark background
 * (contrast ratio < 2:1 against #1C1C1E).
 */
function isDarkOnDark(hex: string): boolean {
  const bgLum = relativeLuminance('#1c1c1e'); // ≈ 0.012
  const fgLum = relativeLuminance(hex.replace(/^#/, '').length === 3
    ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex);
  const lighter = Math.max(fgLum, bgLum);
  const darker  = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05) < 2.0;
}

function estimateLayerLuminance(layer: Layer): number {
  if (layer.fill.type === 'solid' && layer.fill.color) {
    const hex = normalizeHexColor(layer.fill.color);
    if (hex) return relativeLuminance(hex);
  }
  if (layer.fill.type === 'gradient' && 'stops' in layer.fill && layer.fill.stops.length > 0) {
    let sum = 0;
    let count = 0;
    for (const stop of layer.fill.stops) {
      const hex = normalizeHexColor(stop.color);
      if (!hex) continue;
      sum += relativeLuminance(hex);
      count += 1;
    }
    if (count > 0) return sum / count;
  }
  return 0.6;
}

/**
 * Derives a shadow color from the background config.
 * For solid/gradient: uses the bg hue at low lightness, with saturation
 * proportional to the bg's own saturation so neutral backgrounds cast
 * neutral shadows.
 * Future-proof: gradient backgrounds already expose `colors[0]` which
 * carries the dominant stop; we parse that as a fallback.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match
    ? {
        r: parseInt(match[1], 16),
        g: parseInt(match[2], 16),
        b: parseInt(match[3], 16),
      }
    : null;
}

function shadowColorFromBackground(bg: BackgroundConfig): { r: number; g: number; b: number } {
  if (bg.bgType === 'custom' && bg.stops && bg.stops.length > 0) {
    const rgb = hexToRgb(bg.stops[0].color);
    if (rgb) return { r: Math.round(rgb.r * 0.2), g: Math.round(rgb.g * 0.2), b: Math.round(rgb.b * 0.2) };
  }
  // Prefer explicit hue/tint when available (gradient or solid with those fields)
  if (bg.hue !== undefined && bg.tint !== undefined) {
    const hue = bg.hue;
    const saturation = Math.round(Math.max(0, 75 * (1 - bg.tint / 100)));
    // Shadow is always very dark — just the hue tints it
    return hslToRgb(hue, saturation, 12);
  }

  // Fallback: parse the first color stop (covers future gradient types)
  if (bg.colors && bg.colors[0]) {
    return parseHslString(bg.colors[0]) ?? { r: 0, g: 0, b: 20 };
  }

  // Ultimate fallback: near-black with a hint of blue
  return { r: 0, g: 0, b: 20 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

/** Parse "hsl(H, S%, L%)" → RGB at very low lightness for shadow use. */
function parseHslString(hsl: string): { r: number; g: number; b: number } | null {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (!m) return null;
  return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), 12); // use source hue/sat, force dark L
}

// ─── Canvas 2D Liquid Glass helper passes ─────────────────────────────────────

/**
 * Drop shadow derived from the background color.
 * Single-pass: blurred silhouette tinted with a dark version of the bg hue.
 * Draws to `outCtx` BEFORE the glass content (back-most layer).
 */
function drawDropShadow(
  outCtx: CanvasRenderingContext2D,
  contentCanvas: HTMLCanvasElement,
  size: number,
  shadow: LiquidGlassConfig['shadow'],
  background: BackgroundConfig,
  layerConfig: Layer,
  scratch: ScratchPool,
): void {
  if (!shadow.enabled || shadow.value <= 0) return;

  const sv = shadow.value / 100;
  
  // --- 1. Draw the Original Blurred Drop Shadow ---
  // The drop shadow spreads out softly underneath everything.
  const blurPx = sv * size * 0.05;
  const offsetY = sv * size * 0.022;
  const shadowAlpha = sv * 0.35;

  const { r, g, b } = shadowColorFromBackground(background);

  // Chromatic shadow: mix the layer's own fill color into the shadow (~20%)
  // so colored glass casts a subtly tinted shadow
  let fillR = r, fillG = g, fillB = b;
  if (layerConfig.fill.type === 'solid' && layerConfig.fill.color) {
    const hex = layerConfig.fill.color.replace('#', '');
    const fr = parseInt(hex.substring(0, 2), 16);
    const fg = parseInt(hex.substring(2, 4), 16);
    const fb = parseInt(hex.substring(4, 6), 16);
    // Darken the fill color for shadow use and mix at 20%
    fillR = Math.round(r * 0.8 + fr * 0.15 * 0.2);
    fillG = Math.round(g * 0.8 + fg * 0.15 * 0.2);
    fillB = Math.round(b * 0.8 + fb * 0.15 * 0.2);
  } else if (layerConfig.fill.type === 'gradient' && layerConfig.fill.stops.length > 0) {
    const hex = layerConfig.fill.stops[0].color.replace('#', '');
    const fr = parseInt(hex.substring(0, 2), 16);
    const fg = parseInt(hex.substring(2, 4), 16);
    const fb = parseInt(hex.substring(4, 6), 16);
    fillR = Math.round(r * 0.8 + fr * 0.15 * 0.2);
    fillG = Math.round(g * 0.8 + fg * 0.15 * 0.2);
    fillB = Math.round(b * 0.8 + fb * 0.15 * 0.2);
  }

  const shadowCanvas = getCachedShadow(
    layerConfig.id, contentCanvas, size, sv, fillR, fillG, fillB, shadowAlpha, blurPx, offsetY,
    layerConfig.layout.x, layerConfig.layout.y, layerConfig.layout.scale, layerConfig.opacity,
  );
  outCtx.drawImage(shadowCanvas, 0, 0);

}

function drawLayerBevel(
  outCtx: CanvasRenderingContext2D,
  contentCanvas: HTMLCanvasElement,
  size: number,
  lightAngle: number,
  tintCacheKey: string | null,
  liquidGlass: LiquidGlassConfig,
  scratch: ScratchPool,
): void {
  const angleRad = (lightAngle * Math.PI) / 180;
  const lx = Math.cos(angleRad);
  const ly = -Math.sin(angleRad);
  const blurT = liquidGlass.blur?.enabled ? liquidGlass.blur.value / 100 : 0;

  // Sample dominant color of the layer (for rim tinting).
  // Averaged from a 16×16 downsample, mixed 55% toward white for highlight feel.
  // Cached by tintCacheKey (blobUrl+fill) — only re-sampled when content changes, not on move.
  const layerColor = (() => {
    if (tintCacheKey) {
      const hit = layerTintCache.get(tintCacheKey);
      if (hit) return hit;
    }
    const s = 16;
    if (!(_colorSampleCanvas as any)._ctx) {
      (_colorSampleCanvas as any)._ctx = _colorSampleCanvas.getContext('2d')!;
    }
    const tc = (_colorSampleCanvas as any)._ctx as CanvasRenderingContext2D;
    tc.clearRect(0, 0, s, s);
    tc.drawImage(contentCanvas, 0, 0, s, s);
    const data = tc.getImageData(0, 0, s, s).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 60) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    }
    if (n === 0) return { r: 255, g: 255, b: 255 };
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    const mix = 0.55;
    const color = {
      r: Math.round(r + (255 - r) * mix),
      g: Math.round(g + (255 - g) * mix),
      b: Math.round(b + (255 - b) * mix),
    };
    if (tintCacheKey) {
      layerTintCache.set(tintCacheKey, color);
      if (layerTintCache.size > 32) layerTintCache.delete(layerTintCache.keys().next().value!);
    }
    return color;
  })();
  const lc = (a: number) => `rgba(${layerColor.r},${layerColor.g},${layerColor.b},${a})`;

  // ── [1] Inner specular dome ───────────────────────────────────────────────
  {
    const { canvas: domeCv, ctx: dc } = scratch.getCanvas('layer-dome', size);
    dc.drawImage(contentCanvas, 0, 0);
    dc.globalCompositeOperation = 'source-in';
    const litX = size * (0.5 + lx * 0.42);
    const litY = size * (0.5 + ly * 0.42);
    const grad = dc.createRadialGradient(litX, litY, 0, litX, litY, size * LAYER_DOME_RADIUS);
    grad.addColorStop(0.00, `rgba(255,255,255,${LAYER_DOME_CENTER_ALPHA})`);
    grad.addColorStop(0.18, `rgba(255,255,255,${LAYER_DOME_MID_ALPHA})`);
    grad.addColorStop(0.45, `rgba(255,255,255,${LAYER_DOME_EDGE_ALPHA})`);
    grad.addColorStop(0.70, 'rgba(255,255,255,0.00)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    dc.fillStyle = grad;
    dc.fillRect(0, 0, size, size);
    const blur = Math.max(6, size * LAYER_DOME_BLUR_BASE + blurT * size * 0.018);
    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.globalAlpha = LAYER_DOME_INTENSITY;
    outCtx.filter = `blur(${blur}px)`;
    outCtx.drawImage(domeCv, 0, 0);
    outCtx.filter = 'none';
    outCtx.restore();
  }

  // ── [2] Inner colored rim (+ interior holes) ─────────────────────────────
  {
    const rimW = Math.max(3, size * LAYER_INNER_RIM_WIDTH + blurT * size * 0.010);
    const blur = Math.max(0.6, size * LAYER_INNER_RIM_BLUR);

    const buildRimCanvas = (srcCanvas: HTMLCanvasElement, key: string, maskKey: string) => {
      const { canvas: rimCv, ctx: rc } = scratch.getCanvas(key, size);
      rc.drawImage(srcCanvas, 0, 0);
      const { canvas: mask, ctx: mc } = scratch.getCanvas(maskKey, size);
      mc.filter = `blur(${Math.max(1.2, rimW * 0.38)}px)`;
      mc.drawImage(srcCanvas, rimW / 2, rimW / 2, size - rimW, size - rimW);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(mask, 0, 0);
      rc.globalCompositeOperation = 'source-in';
      const grad = rc.createLinearGradient(
        size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
        size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
      );
      grad.addColorStop(0.00, lc(LAYER_INNER_RIM_LIT_ALPHA));
      grad.addColorStop(0.40, lc(LAYER_INNER_RIM_MID_ALPHA));
      grad.addColorStop(0.70, lc(LAYER_INNER_RIM_SHADOW_ALPHA + 0.10));
      grad.addColorStop(1.00, lc(LAYER_INNER_RIM_SHADOW_ALPHA));
      rc.fillStyle = grad;
      rc.fillRect(0, 0, size, size);
      return rimCv;
    };

    // Outer shape rim
    const rimCv = buildRimCanvas(contentCanvas, 'layer-rim', 'layer-rim-mask');
    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.globalAlpha = LAYER_INNER_RIM_ALPHA_BLUR;
    outCtx.filter = `blur(${blur}px)`;
    outCtx.drawImage(rimCv, 0, 0);
    outCtx.filter = 'none';
    outCtx.globalAlpha = LAYER_INNER_RIM_ALPHA_SHARP;
    outCtx.drawImage(rimCv, 0, 0);
    outCtx.restore();

    // Interior holes rim (transparent cutouts inside the shape)
    {
      const { canvas: holeCv, ctx: hc } = scratch.getCanvas('layer-holes', size);
      hc.fillStyle = 'rgba(255,255,255,1)';
      hc.fillRect(0, 0, size, size);
      hc.globalCompositeOperation = 'destination-out';
      hc.drawImage(contentCanvas, 0, 0);
      const { canvas: holeMask, ctx: hm } = scratch.getCanvas('layer-holes-mask', size);
      hm.filter = `blur(${Math.max(1.2, rimW * 0.38)}px)`;
      hm.drawImage(holeCv, rimW / 2, rimW / 2, size - rimW, size - rimW);
      hc.globalCompositeOperation = 'destination-out';
      hc.drawImage(holeMask, 0, 0);
      // Clip to dilated content — removes exterior transparent area
      const { canvas: dilCv, ctx: dc } = scratch.getCanvas('layer-holes-dilate', size);
      const dpad = rimW * 1.2;
      dc.filter = `blur(${rimW * 0.6}px)`;
      dc.drawImage(contentCanvas, -dpad, -dpad, size + dpad * 2, size + dpad * 2);
      dc.filter = 'none';
      hc.globalCompositeOperation = 'destination-in';
      hc.drawImage(dilCv, 0, 0);
      // Color same as outer rim
      const grad = hc.createLinearGradient(
        size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
        size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
      );
      grad.addColorStop(0.00, lc(LAYER_INNER_RIM_LIT_ALPHA));
      grad.addColorStop(0.40, lc(LAYER_INNER_RIM_MID_ALPHA));
      grad.addColorStop(1.00, lc(LAYER_INNER_RIM_SHADOW_ALPHA));
      hc.globalCompositeOperation = 'source-in';
      hc.fillStyle = grad;
      hc.fillRect(0, 0, size, size);
      outCtx.save();
      outCtx.globalCompositeOperation = 'screen';
      outCtx.globalAlpha = LAYER_HOLES_RIM_ALPHA_BLUR;
      outCtx.filter = `blur(${blur}px)`;
      outCtx.drawImage(holeCv, 0, 0);
      outCtx.filter = 'none';
      outCtx.globalAlpha = LAYER_HOLES_RIM_ALPHA_SHARP;
      outCtx.drawImage(holeCv, 0, 0);
      outCtx.restore();
    }
  }

  // ── [4] Inner shadow on the shadow side ──────────────────────────────────
  {
    const darkW = Math.max(2, size * LAYER_INNER_SHADOW_WIDTH + blurT * size * 0.006);
    const { canvas: darkCv, ctx: dc } = scratch.getCanvas('layer-inner-shadow', size);
    dc.drawImage(contentCanvas, 0, 0);
    const { canvas: darkMask, ctx: dm } = scratch.getCanvas('layer-inner-shadow-mask', size);
    dm.filter = `blur(${Math.max(2, darkW * 0.55)}px)`;
    dm.drawImage(contentCanvas, darkW / 2, darkW / 2, size - darkW, size - darkW);
    dc.globalCompositeOperation = 'destination-out';
    dc.drawImage(darkMask, 0, 0);
    dc.globalCompositeOperation = 'source-in';
    const grad = dc.createLinearGradient(
      size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
    );
    grad.addColorStop(0.00, `rgba(0,0,10,${LAYER_INNER_SHADOW_DARK_ALPHA})`);
    grad.addColorStop(0.20, `rgba(0,0,10,${LAYER_INNER_SHADOW_MID_ALPHA})`);
    grad.addColorStop(0.50, 'rgba(0,0,10,0.00)');
    dc.fillStyle = grad;
    dc.fillRect(0, 0, size, size);
    const blur = Math.max(2, size * LAYER_INNER_SHADOW_BLUR + blurT * size * 0.003);
    outCtx.save();
    outCtx.globalCompositeOperation = 'multiply';
    outCtx.globalAlpha = LAYER_INNER_SHADOW_ALPHA_BLUR;
    outCtx.filter = `blur(${blur}px)`;
    outCtx.drawImage(darkCv, 0, 0);
    outCtx.filter = 'none';
    outCtx.globalAlpha = LAYER_INNER_SHADOW_ALPHA_SHARP;
    outCtx.drawImage(darkCv, 0, 0);
    outCtx.restore();
  }

  // ── [5] Outer border ring (layer color, outside shape) ───────────────────
  {
    const dilate = Math.max(1.5, size * LAYER_OUTER_BORDER_WIDTH);
    const expand = dilate * 2;
    const { canvas: outerCv, ctx: oc } = scratch.getCanvas('layer-outer-border', size);
    oc.filter = `blur(${Math.max(0.5, dilate * 0.5)}px)`;
    oc.drawImage(contentCanvas, -dilate, -dilate, size + expand, size + expand);
    oc.filter = 'none';
    oc.globalCompositeOperation = 'destination-out';
    oc.drawImage(contentCanvas, 0, 0);
    oc.globalCompositeOperation = 'source-in';
    oc.drawImage(contentCanvas, -dilate, -dilate, size + expand, size + expand);
    outCtx.save();
    outCtx.globalCompositeOperation = 'source-over';
    outCtx.globalAlpha = LAYER_OUTER_BORDER_ALPHA;
    outCtx.drawImage(outerCv, 0, 0);
    outCtx.restore();
  }
}

/**
 * Full Canvas 2D Liquid Glass pipeline (used when WebGL is unavailable).
 * Passes: shadow → blurred bg → tint → content → specular → rim → border → inner shadow.
 */
async function renderLayerCanvas2D(
  outCtx: CanvasRenderingContext2D,
  contentCanvas: HTMLCanvasElement,
  size: number,
  mode: AppearanceMode,
  lightAngle: number,
  bgCanvas: HTMLCanvasElement,
  liquidGlass: LiquidGlassConfig,
  layerOpacity: number,
  layerBlendMode: string,
  background: BackgroundConfig,
  layer: Layer,
  scratch: ScratchPool,
): Promise<void> {
  const dark = isDarkMode(mode);
  const angleRad = (lightAngle * Math.PI) / 180;
  const lx = Math.cos(angleRad);
  const ly = -Math.sin(angleRad);
  const translucency = mapTranslucency(
    liquidGlass.translucency.value,
    liquidGlass.translucency.enabled,
    0.50,
  );
  const blurStrength = liquidGlass.blur.enabled ? liquidGlass.blur.value / 100 : 0.35;
  const blurRadius = Math.max(0.5, blurStrength * size * 0.028);
  const layerAlpha = layerOpacity / 100;
  const layerLuma = estimateLayerLuminance(layer);
  const minTranslucency = Math.max(translucency, 0.18);
  const lumaWeight = Math.min(layerLuma * 4, 1);
  const smartTranslucency = minTranslucency + (translucency - minTranslucency) * lumaWeight;

  // ── 1. Drop shadow ────────────────────────────────────────────────────────
  drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow, background, layer, scratch);

  // ── 2. Blurred background with displacement refraction ─────────────────────
  {
    const { canvas: blurredBg, ctx: bb } = scratch.getCanvas('layer-blur-bg', size);
    const sat = dark ? '145%' : '100%';
    bb.filter = `blur(${blurRadius}px) saturate(${sat})`;
    bb.drawImage(bgCanvas, 0, 0);
    bb.filter = 'none';

    // ── Displacement refraction: shift blurred bg pixels based on alpha gradient ──
    // This creates visible edge bending/magnification that was previously
    // only available in the WebGL path. Uses a downsampled grid for performance.
    const refractionStrength = 8; // max pixel displacement at edges
    if (refractionStrength > 0 && size >= 64) {
      // Read content alpha to compute gradient (displacement map)
      const contentCtx = contentCanvas.getContext('2d')!;
      const alphaData = contentCtx.getImageData(0, 0, size, size);
      const bgData = bb.getImageData(0, 0, size, size);
      const outData = scratch.getImageData('layer-refraction', size);
      const src = bgData.data;
      const dst = outData.data;
      const alpha = alphaData.data;

      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const idx = (y * size + x) * 4;
          const a = alpha[idx + 3] / 255;

          if (a < 0.01) {
            // Outside glass: copy original
            dst[idx] = src[idx]; dst[idx+1] = src[idx+1];
            dst[idx+2] = src[idx+2]; dst[idx+3] = src[idx+3];
            continue;
          }

          // Central-difference alpha gradient
          const aR = alpha[((y) * size + (x+1)) * 4 + 3] / 255;
          const aL = alpha[((y) * size + (x-1)) * 4 + 3] / 255;
          const aU = alpha[((y-1) * size + (x)) * 4 + 3] / 255;
          const aD = alpha[((y+1) * size + (x)) * 4 + 3] / 255;
          const gx = (aR - aL) * 0.5;
          const gy = (aD - aU) * 0.5;
          const gradLen = Math.sqrt(gx * gx + gy * gy);

          // Only displace near edges (where gradient is significant)
          const edgeFactor = Math.min(gradLen * 4, 1);
          const dx = gx * refractionStrength * edgeFactor;
          const dy = gy * refractionStrength * edgeFactor;

          // Sample source with displacement (bilinear)
          const sx = Math.max(0, Math.min(size - 1, x + dx));
          const sy = Math.max(0, Math.min(size - 1, y + dy));
          const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
          const fx = sx - sx0, fy = sy - sy0;
          const sx1 = Math.min(sx0 + 1, size - 1);
          const sy1 = Math.min(sy0 + 1, size - 1);

          for (let c = 0; c < 4; c++) {
            const v00 = src[(sy0 * size + sx0) * 4 + c];
            const v10 = src[(sy0 * size + sx1) * 4 + c];
            const v01 = src[(sy1 * size + sx0) * 4 + c];
            const v11 = src[(sy1 * size + sx1) * 4 + c];
            dst[idx + c] = Math.round(
              v00 * (1-fx) * (1-fy) + v10 * fx * (1-fy) +
              v01 * (1-fx) * fy + v11 * fx * fy
            );
          }
        }
      }
      bb.putImageData(outData, 0, 0);
    }

    // Clip to content alpha
    const { canvas: clipped, ctx: cc } = scratch.getCanvas('layer-clip', size);
    cc.drawImage(blurredBg, 0, 0);
    cc.globalCompositeOperation = 'destination-in';
    cc.drawImage(contentCanvas, 0, 0);

    // Tint overlay (clipped)
    cc.globalCompositeOperation = 'source-over';
    const tintAlpha = dark ? 0.18 : 0.10;
    const tintColor = dark ? `rgba(10,10,22,${tintAlpha})` : `rgba(255,255,255,${tintAlpha})`;
    const { canvas: tintCanvas, ctx: tc } = scratch.getCanvas('layer-tint', size);
    tc.fillStyle = tintColor;
    tc.fillRect(0, 0, size, size);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(contentCanvas, 0, 0);
    cc.drawImage(tintCanvas, 0, 0);

    outCtx.save();
    outCtx.globalAlpha = translucency;
    outCtx.drawImage(clipped, 0, 0);
    outCtx.restore();
  }

  // ── 3. Content (partially transparent — glass shows through) ─────────────
  {
    const contentAlpha = 1.0 - translucency;
    outCtx.save();
    outCtx.globalAlpha = contentAlpha * (layerOpacity / 100);
    outCtx.globalCompositeOperation = blendModeToCanvas(layerBlendMode);
    outCtx.drawImage(contentCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 4. Specular highlight (corner-anchored, fades inward) ────────────────
  if (liquidGlass.specular) {
    // Place hotspot at the lit corner � tighter and edge-limited (no visible ball)
    const hx = size * (0.5 + lx * 0.50);
    const hy = size * (0.5 + ly * 0.50);

    const { canvas: specCanvas, ctx: sc } = scratch.getCanvas('layer-spec', size);

    // Tight radial glow that stays close to the rim
    const specGrad = sc.createRadialGradient(hx, hy, 0, hx, hy, size * LAYER_SPECULAR_RADIUS);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      specGrad.addColorStop(t, `rgba(255,255,255,${(LAYER_SPECULAR_PEAK_ALPHA * Math.pow(1 - t, 4.2)).toFixed(3)})`);
    }
    sc.fillStyle = specGrad;
    sc.fillRect(0, 0, size, size);

    // Clip to content shape
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(contentCanvas, 0, 0);

    // Remove interior so highlight stays at the rim
    const edgeWidth = Math.max(3.0, size * 0.010);
    const { canvas: edgeMask, ctx: em } = scratch.getCanvas('layer-spec-edge-mask', size);
    em.filter = `blur(${Math.max(1.0, edgeWidth * 0.35)}px)`;
    em.drawImage(contentCanvas, edgeWidth / 2, edgeWidth / 2, size - edgeWidth, size - edgeWidth);
    sc.globalCompositeOperation = 'destination-out';
    sc.drawImage(edgeMask, 0, 0);

    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.drawImage(specCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 5. Fresnel rim light ──────────────────────────────────────────────────
  {
    const gx1 = size * (0.5 + lx * 0.56);
    const gy1 = size * (0.5 + ly * 0.56);
    const gx2 = size * (0.5 - lx * 0.56);
    const gy2 = size * (0.5 - ly * 0.56);

    const { canvas: rimCanvas, ctx: rc } = scratch.getCanvas('layer-rim', size);

    const rimGrad = rc.createLinearGradient(gx1, gy1, gx2, gy2);
    rimGrad.addColorStop(0.00, `rgba(255,255,255,${LAYER_FRESNEL_LIT_ALPHA})`);
    rimGrad.addColorStop(0.22, `rgba(255,255,255,${LAYER_FRESNEL_MID_ALPHA})`);
    rimGrad.addColorStop(0.55, 'rgba(255,255,255,0.01)');
    rimGrad.addColorStop(1.00, `rgba(255,255,255,${LAYER_FRESNEL_SHADOW_ALPHA})`);

    rc.fillStyle = rimGrad;
    rc.fillRect(0, 0, size, size);
    rc.globalCompositeOperation = 'destination-in';
    rc.drawImage(contentCanvas, 0, 0);

    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.drawImage(rimCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 5a. Inset Top Highlight (inset 0 2px #fff3) ──────────────────────────
  {
    const insetOff = Math.max(1, size * 0.002); // ~2px at 1024
    const { canvas: insetCanvas, ctx: ic } = scratch.getCanvas('layer-inset', size);

    // Highlight at the top: opaque here, transparent above
    ic.drawImage(contentCanvas, 0, 0);
    ic.globalCompositeOperation = 'destination-out';
    ic.drawImage(contentCanvas, 0, -insetOff);

    // Color: soft white
    ic.globalCompositeOperation = 'source-in';
    ic.fillStyle = `rgba(255,255,255,${LAYER_INSET_ALPHA})`;
    ic.fillRect(0, 0, size, size);

    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    // Weighted by light angle (only Top-Left if angle is 135)
    outCtx.globalAlpha = Math.max(0.2, (lx * 0.5 + 0.5) * (-ly * 0.5 + 0.5));
    outCtx.drawImage(insetCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 5b. Edge inner glow (warm luminous band inside edges) ─────────────────
  {
    const erodeGlow = Math.max(3, size * LAYER_INNER_GLOW_WIDTH);
    const { canvas: glowCanvas, ctx: gc } = scratch.getCanvas('layer-glow', size);

    // Start with content shape
    gc.drawImage(contentCanvas, 0, 0);

    // Erode inward to create the inner glow ring
    const { canvas: innerMask, ctx: im } = scratch.getCanvas('layer-glow-mask', size);
    im.filter = `blur(${Math.max(2, erodeGlow * 0.5)}px)`;
    im.drawImage(contentCanvas, erodeGlow / 2, erodeGlow / 2, size - erodeGlow, size - erodeGlow);
    gc.globalCompositeOperation = 'destination-out';
    gc.drawImage(innerMask, 0, 0);

    // Color: warm radial glow from lit corner
    gc.globalCompositeOperation = 'source-in';
    const glowX = size * (0.5 + lx * 0.4);
    const glowY = size * (0.5 + ly * 0.4);
    const glowGrad = gc.createRadialGradient(glowX, glowY, 0, glowX, glowY, size * 0.7);
    const glowColor = dark ? '100,120,170' : '255,245,225';
    glowGrad.addColorStop(0.00, `rgba(${glowColor},${LAYER_INNER_GLOW_LIT_ALPHA})`);
    glowGrad.addColorStop(0.30, `rgba(${glowColor},${LAYER_INNER_GLOW_MID_ALPHA})`);
    glowGrad.addColorStop(0.60, `rgba(${glowColor},${LAYER_INNER_GLOW_EDGE_ALPHA})`);
    glowGrad.addColorStop(1.00, `rgba(${glowColor},0.00)`);
    gc.fillStyle = glowGrad;
    gc.fillRect(0, 0, size, size);

    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.drawImage(glowCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 5c. Light-angle content dimming (shadow side darkened) ─────────────────
  {
    const { canvas: dimCanvas, ctx: dc } = scratch.getCanvas('layer-dim', size);

    // Directional gradient: shadow side darkened ~12%
    const dimGrad = dc.createLinearGradient(
      size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
    );
    dimGrad.addColorStop(0.00, `rgba(0,0,0,${(LAYER_DIM_SHADOW_ALPHA * translucency).toFixed(3)})`);
    dimGrad.addColorStop(0.45, 'rgba(0,0,0,0.02)');
    dimGrad.addColorStop(1.00, 'rgba(0,0,0,0.00)');
    dc.fillStyle = dimGrad;
    dc.fillRect(0, 0, size, size);

    // Clip to content shape
    dc.globalCompositeOperation = 'destination-in';
    dc.drawImage(contentCanvas, 0, 0);

    outCtx.save();
    outCtx.globalCompositeOperation = 'multiply';
    outCtx.drawImage(dimCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 6. Layer bevel (inner bright rim + dark outer border) ────────────────
  const _tintKey2D = `${layer.id}:${layer.blobUrl ?? ''}:${layer.fill.type}:${layer.fill.type === 'solid' ? (layer.fill as any).color ?? '' : ''}`;
  drawLayerBevel(outCtx, contentCanvas, size, lightAngle, _tintKey2D, liquidGlass, scratch);

  // ── 7. Directional Inner Shadow (away from light) ─────────────────────────
  {
    const { canvas: innerCanvas, ctx: ic } = scratch.getCanvas('layer-inner', size);

    // Create a directional gradient that darkens the far side of the light
    const shadowX = size * (0.5 - lx * 0.5);
    const shadowY = size * (0.5 - ly * 0.5);
    const innerGrad = ic.createLinearGradient(
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
      shadowX, shadowY
    );
    innerGrad.addColorStop(0.0, 'rgba(0,0,0,0)');
    innerGrad.addColorStop(0.6, dark ? `rgba(0,0,20,${LAYER_DIR_SHADOW_MID_DARK})` : `rgba(0,0,20,${LAYER_DIR_SHADOW_MID_LIGHT})`);
    innerGrad.addColorStop(1.0, dark ? `rgba(0,0,20,${LAYER_DIR_SHADOW_MAX_DARK})` : `rgba(0,0,20,${LAYER_DIR_SHADOW_MAX_LIGHT})`);
    
    ic.fillStyle = innerGrad;
    ic.fillRect(0, 0, size, size);
    ic.globalCompositeOperation = 'destination-in';
    ic.drawImage(contentCanvas, 0, 0);

    outCtx.save();
    outCtx.globalCompositeOperation = 'multiply';
    outCtx.drawImage(innerCanvas, 0, 0);
    outCtx.restore();
  }
}

// ─── Build content canvas (fill + SVG) ───────────────────────────────────────

async function buildContentCanvas(
  layer: Layer,
  size: number,
  appearanceMode: AppearanceMode = 'default',
): Promise<HTMLCanvasElement> {
  const { layout } = layer;
  const scale = layout.scale / 100;
  const offsetX = (layout.x / 100) * size;
  const offsetY = (layout.y / 100) * size;
  const isClear = appearanceMode === 'clear';
  const isDark  = appearanceMode === 'dark';

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.save();
  ctx.translate(size / 2 + offsetX, size / 2 + offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-size / 2, -size / 2);

  if (layer.blobUrl) {
    // Image-based layer
    try {
      const img = await getCachedImage(layer.blobUrl);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const sc = Math.min(size / iw, size / ih);
      const w = iw * sc;
      const h = ih * sc;
      const x = (size - w) / 2;
      const y = (size - h) / 2;

      // Draw image first (establishes the alpha mask shape).
      // Use hi-res version if available (preloaded at 2048px, synchronous lookup).
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const drawSource = hiResImgCache.get(layer.blobUrl) ?? img;
      ctx.drawImage(drawSource, x, y, w, h);

      // Apply fill / colour tint clipped to the image's alpha using source-atop.
      // This ensures fill never bleeds outside the icon artwork shape.
      ctx.globalCompositeOperation = 'source-atop';
      if (isClear) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
      } else if (isDark) {
        if (layer.fill.type === 'solid') {
          // Near-black fill → convert to white; contrasting fill → keep
          const fillColor = layer.fill.color ?? '#000000';
          ctx.fillStyle = isDarkOnDark(fillColor) ? '#ffffff' : fillColor;
          ctx.fillRect(0, 0, size, size);
        } else if (layer.fill.type === 'gradient' && 'stops' in layer.fill) {
          // Gradient fills are kept as-is (user intent)
          const grad = ctx.createLinearGradient(0, 0, 0, size);
          layer.fill.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, size, size);
        } else {
          // fill.type === 'none' → treat image as template: render as white
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
        }
      } else if (layer.fill.type === 'solid') {
        ctx.fillStyle = layer.fill.color ?? '#ffffff';
        ctx.fillRect(0, 0, size, size);
      } else if (layer.fill.type === 'gradient' && 'stops' in layer.fill) {
        const grad = ctx.createLinearGradient(0, 0, 0, size);
        layer.fill.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';
    } catch { /* ignore broken blobs */ }
  } else {
    // Fill-only layer (no image) — clip to squircle so fill stays within icon shape
    drawSquirclePath(ctx, 0, 0, size);
    ctx.clip();
    if (layer.fill.type === 'solid') {
      let fillColor = layer.fill.color ?? '#ffffff';
      if (isClear) fillColor = '#ffffff';
      else if (isDark && isDarkOnDark(fillColor)) fillColor = '#ffffff';
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, size, size);
    } else if (layer.fill.type === 'gradient' && 'stops' in layer.fill) {
      if (isClear) {
        ctx.fillStyle = '#ffffff';
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, size);
        layer.fill.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
        ctx.fillStyle = grad;
      }
      ctx.fillRect(0, 0, size, size);
    }
    // fill.type === 'none' → nothing drawn → transparent layer
  }

  ctx.restore();

  // ── Soft-edge pass: blur the content canvas by ~1px to smooth alpha edges ──
  // This makes the WebGL edge/normal detection smooth instead of 1-bit staircase.
  // At 1000px canvas a 0.8px blur is invisible to the eye but eliminates aliasing
  // in the glass border glow and Fresnel rim.
  const blurPx = Math.max(1.0, size * 0.0013);
  const softCanvas = document.createElement('canvas');
  softCanvas.width = softCanvas.height = size;
  const sc = softCanvas.getContext('2d')!;
  sc.filter = `blur(${blurPx}px)`;
  sc.drawImage(canvas, 0, 0);
  return softCanvas;
}

// ─── Render a single layer ────────────────────────────────────────────────────

async function renderLayerToCanvas(
  layer: Layer,
  size: number,
  mode: AppearanceMode,
  lightAngle: number,
  bgCanvas: HTMLCanvasElement,
  background: BackgroundConfig,
  scratch: ScratchPool,
  allowSpecular: boolean,
  bgKey = '',
): Promise<HTMLCanvasElement | null> {
  if (!layer.visible) return null;

  const contentCanvas = await buildContentCanvas(layer, size, mode);
  const liquidGlass = allowSpecular
    ? layer.liquidGlass
    : { ...layer.liquidGlass, specular: false };

  // ── Output canvas ─────────────────────────────────────────────────────────
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const outCtx = out.getContext('2d')!;

  if (!liquidGlass.enabled) {
    // Plain pass-through
    outCtx.save();
    outCtx.globalAlpha = layer.opacity / 100;
    outCtx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);
    outCtx.drawImage(contentCanvas, 0, 0);
    outCtx.restore();
    return out;
  }

  // ── Try WebGL path ────────────────────────────────────────────────────────
  const renderer = getWebGLRenderer(size);
  if (renderer && _glCanvas) {
    try {
      const glMode: 0 | 1 | 2 =
        mode === 'dark' ? 1
          : mode === 'clear' ? 2
            : 0;

      const params: LiquidGlassParams = {
        blur: liquidGlass.blur.enabled ? liquidGlass.blur.value / 100 : 0.35,
        translucency: mapTranslucency(
          liquidGlass.translucency.value,
          liquidGlass.translucency.enabled,
          0.55,
        ),
        specular: liquidGlass.specular,
        specularIntensity: 1.0,
        lightAngle,
        opacity: layer.opacity / 100,
        mode: glMode,
        darkAdjust: liquidGlass.dark?.enabled ? liquidGlass.dark.value / 100 : 0,
        monoAdjust: liquidGlass.mono?.enabled ? liquidGlass.mono.value / 100 : 0,
        aberration: 0.65, // always-on chromatic aberration at moderate intensity
      };

      renderer.render(contentCanvas, bgCanvas, params, bgKey);
      setWebgl2Status('active');

      // ── Drop shadow (Canvas 2D, pre-glass) ────────────────────────────────
      drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow, background, layer, scratch);

      // ── WebGL glass result ────────────────────────────────────────────────
      outCtx.save();
      outCtx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);
      outCtx.drawImage(_glCanvas, 0, 0);
      outCtx.restore();

      // ── Layer bevel (inner bright rim + dark outer border) ────────────────
      const _tintKeyGL = `${layer.id}:${layer.blobUrl ?? ''}:${layer.fill.type}:${layer.fill.type === 'solid' ? (layer.fill as any).color ?? '' : ''}`;
      drawLayerBevel(outCtx, contentCanvas, size, lightAngle, _tintKeyGL, liquidGlass, scratch);

      return out;
    } catch (err) {
      reportWebglError(err);
      // fall through to Canvas 2D
    }
  }

  // ── Canvas 2D fallback ────────────────────────────────────────────────────
  await renderLayerCanvas2D(
    outCtx, contentCanvas, size, mode, lightAngle, bgCanvas,
    liquidGlass, layer.opacity, layer.blendMode, background, layer, scratch,
  );

  return out;
}


// ─── Main compositor ──────────────────────────────────────────────────────────

export async function renderIconToCanvas(
  outputCanvas: HTMLCanvasElement,
  ctx: RenderContext,
): Promise<void> {
  const { layers, background, lightAngle, appearanceMode, size } = ctx;

  // Reset per-render WebGL indicator (set to active if any layer uses WebGL).
  setWebgl2Status('inactive');
  const scratch = createScratchPool();
  const specularLayerId = findSpecularLayerId(layers);

  // ── Double-buffering: render into scratch canvas, swap atomically at end ──
  // This prevents white flash when outputCanvas.width/height changes during render.
  const { canvas: masterCanvas, ctx: c } = getScratchCanvas('master-buffer', size);

  // Build base background canvas (cached — skips re-creation when bg config unchanged)
  const darkBg: BackgroundConfig = { type: 'solid', color: '#1c1c1e', colors: ['#1c1c1e', '#1c1c1e'], hue: 0, tint: 0 };
  const clearBg: BackgroundConfig = { type: 'solid', color: 'rgba(230,230,235,1)', colors: ['rgba(230,230,235,1)', 'rgba(230,230,235,1)'], hue: 0, tint: 0 };
  const { canvas: bgCanvas, key: bgKey } = appearanceMode === 'dark'
    ? getCachedBgCanvas(darkBg, size)
    : getCachedBgCanvas(background, size);

  // For glass blur in clear mode, use a neutral light background (simulates wallpaper)
  const { canvas: glassBgCanvas, key: glassBgKey } = appearanceMode === 'clear'
    ? getCachedBgCanvas(clearBg, size)
    : { canvas: bgCanvas, key: bgKey };


  // ── Squircle drop shadow (default/dark only — clear mode exports as transparent PNG) ──
  if (appearanceMode !== 'clear') {
    // In dark mode the bg is always #1C1C1E — use a neutral near-black shadow
    const { r: sr, g: sg, b: sb } = appearanceMode === 'dark'
      ? { r: 0, g: 0, b: 0 }
      : shadowColorFromBackground(background);
    c.save();
    c.shadowColor = `rgba(${sr},${sg},${sb},0.48)`;
    c.shadowBlur = size * 0.055;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = size * 0.022;
    drawSquirclePath(c, 0, 0, size);
    c.fillStyle = '#000000'; // opaque — gets covered by the real icon below
    c.fill();
    c.restore();
  }

  // ── Squircle-clipped icon content ─────────────────────────────────────────
  c.save();
  drawSquirclePath(c, 0, 0, size);
  c.clip();

  // Draw background — clear mode has transparent bg (only glass blur uses bgCanvas)
  if (appearanceMode !== 'clear') {
    c.drawImage(bgCanvas, 0, 0, size, size);
  }

  // Sort and composite layers with feed-forward glass compositing:
  // Each glass layer refracts through the accumulated result of all layers
  // below it (background + earlier layers), creating proper glass-on-glass depth.
  const rootLayers = [...layers]
    .filter((l) => l.visible && l.parentId === null)
    .sort((a, b) => a.order - b.order);

  // Running background: starts as the base background, accumulates composited layers
  const runningBg = document.createElement('canvas');
  runningBg.width = runningBg.height = size;
  const rbCtx = runningBg.getContext('2d')!;
  rbCtx.drawImage(glassBgCanvas, 0, 0);

  for (const layer of rootLayers) {
    // Determine which bg canvas to feed to glass: the running composite
    const feedBg = layer.liquidGlass?.enabled ? runningBg : glassBgCanvas;

    if (layer.type === 'group') {
      const children = [...layers]
        .filter((l) => l.parentId === layer.id && l.visible)
        .sort((a, b) => a.order - b.order);

      // Render all children into an intermediate canvas, then apply group opacity once
      const groupCanvas = document.createElement('canvas');
      groupCanvas.width = groupCanvas.height = size;
      const gc = groupCanvas.getContext('2d')!;

      for (const child of children) {
        const childFeedBg = child.liquidGlass?.enabled ? runningBg : glassBgCanvas;
        const lc = await renderLayerToCanvas(
          child,
          size,
          appearanceMode,
          lightAngle,
          childFeedBg,
          background,
          scratch,
          child.id === specularLayerId,
          glassBgKey,
        );
        if (lc) {
          gc.drawImage(lc, 0, 0);
          // Update running bg with this child's output
          rbCtx.drawImage(lc, 0, 0);
        }
      }

      c.globalAlpha = layer.opacity / 100;
      c.drawImage(groupCanvas, 0, 0);
      c.globalAlpha = 1;
    } else {
      const lc = await renderLayerToCanvas(
        layer,
        size,
        appearanceMode,
        lightAngle,
        feedBg,
        background,
        scratch,
        layer.id === specularLayerId,
        glassBgKey,
      );
      if (lc) {
        c.drawImage(lc, 0, 0);
        // Update running bg with this layer's output for subsequent layers
        rbCtx.drawImage(lc, 0, 0);
      }
    }
  }

  c.restore(); // end squircle clip

  // ── Squircle glass rim ────────────────────────────────────────────────────
  //
  //  Visual map (what you SEE on the icon, not code internals):
  //
  //  [A] Inner colored rim — thick stroke just inside the squircle edge.
  //      This is the prominent colored/white ring visible all around the icon border.
  //      Color = bg color (so blue bg → blue rim, orange → orange rim).
  //      Stronger on the lit side, softer on the shadow side.
  //
  //  [B] GLARE — tiny bright white hotspot at the lit corner only.
  //      Very thin, always white — simulates sharp specular on the bevel tip.
  //
  //  [C] Shadow border (dark outer stroke) — darkens the outer pixel of the squircle.
  //      Strongest on the shadow side. Creates the "raised" depth illusion.
  //
  {
    const angleRad = (lightAngle * Math.PI) / 180;
    const lx = Math.cos(angleRad);
    const ly = -Math.sin(angleRad);

    // Sample bg color for [A]. Mix lightly toward white (25%) so it reads as a
    // highlight, not the flat fill. Lower mix = more saturated/vivid color in the rim.
    // Dark & Clear modes: use neutral white rim (bg color is near-black / irrelevant).
    const bgSample = (() => {
      if (appearanceMode === 'dark' || appearanceMode === 'clear') {
        return { r: 255, g: 255, b: 255 };
      }

      let r = 255, g = 255, b = 255;

      if (background.bgType === 'custom' && background.stops && background.stops.length > 0) {
        const rgb = hexToRgb(background.stops[0].color);
        if (rgb) { r = rgb.r; g = rgb.g; b = rgb.b; }
      } else if (background.hue !== undefined && background.tint !== undefined) {
        const h = background.hue;
        const s = Math.round(85 * (1 - background.tint / 100));
        const l = Math.min(100, Math.round((48 + background.tint * 0.52) * (background.brightness ?? 100) / 100));
        const rgb = hslToRgb(h, s, l);
        r = rgb.r; g = rgb.g; b = rgb.b;
      } else if (background.colors && background.colors[0]) {
        const rgb = parseHslString(background.colors[0]);
        if (rgb) { r = rgb.r; g = rgb.g; b = rgb.b; }
      }

      // Boost saturation before mixing toward white
      const avg = (r + g + b) / 3;
      r = Math.min(255, Math.max(0, Math.round(avg + (r - avg) * 1.5)));
      g = Math.min(255, Math.max(0, Math.round(avg + (g - avg) * 1.5)));
      b = Math.min(255, Math.max(0, Math.round(avg + (b - avg) * 1.5)));

      // Mix 25% toward white — keeps vivid color while being readable as a highlight
      const mix = 0.25;
      return {
        r: Math.round(r + (255 - r) * mix),
        g: Math.round(g + (255 - g) * mix),
        b: Math.round(b + (255 - b) * mix),
      };
    })();
    const bg = (a: number) => `rgba(${bgSample.r},${bgSample.g},${bgSample.b},${a})`;

    // [A] Inner colored rim
    // Thick stroke running just inside the squircle boundary, colored with bg.
    // Lit side is bright, shadow side fades to ~30% intensity (still visible = depth).
    {
      const inset   = Math.max(3.5, size * 0.0055);
      const lw      = Math.max(3.5, size * 0.0055);
      const blurPx  = Math.max(2.0, size * 0.0028);
      const grad = c.createLinearGradient(
        size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),  // lit corner
        size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),  // shadow corner
      );
      grad.addColorStop(0.00, bg(0.90));   // lit side — vivid and bright
      grad.addColorStop(0.30, bg(0.60));
      grad.addColorStop(0.65, bg(0.30));
      grad.addColorStop(1.00, bg(0.18));   // shadow side — still present = 3D wrap
      c.save();
      c.translate(inset, inset);
      c.filter = `blur(${blurPx}px)`;
      drawSquirclePath(c, 0, 0, size - inset * 2);
      c.strokeStyle = grad;
      c.lineWidth = lw;
      c.globalCompositeOperation = 'screen';
      c.stroke();
      c.restore();
    }

    // [B] GLARE — pure white micro-hotspot on the lit corner bevel tip
    {
      const glx   = Math.cos(angleRad + 0.15);
      const gly   = -Math.sin(angleRad + 0.15);
      const inset = Math.max(1.2, size * 0.0025);
      const grad  = c.createLinearGradient(
        size * (0.5 + glx * 0.5), size * (0.5 + gly * 0.5),
        size * 0.5, size * 0.5,
      );
      grad.addColorStop(0.00, 'rgba(255,255,255,0.85)');
      grad.addColorStop(0.10, 'rgba(255,255,255,0.30)');
      grad.addColorStop(0.28, 'rgba(255,255,255,0.00)');
      c.save();
      c.translate(inset, inset);
      drawSquirclePath(c, 0, 0, size - inset * 2);
      c.strokeStyle = grad;
      c.lineWidth = Math.max(1.0, size * 0.0015);
      c.globalCompositeOperation = 'screen';
      c.stroke();
      c.restore();
    }

    // [C] Shadow border — dark outer stroke at the squircle boundary, shadow side
    {
      const grad = c.createLinearGradient(
        size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),  // shadow corner
        size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),  // lit corner
      );
      grad.addColorStop(0.00, 'rgba(0,0,15,0.34)');
      grad.addColorStop(0.28, 'rgba(0,0,15,0.12)');
      grad.addColorStop(0.55, 'rgba(0,0,15,0.00)');
      c.save();
      drawSquirclePath(c, 0, 0, size);
      c.strokeStyle = grad;
      c.lineWidth = Math.max(2.4, size * 0.004);
      c.globalCompositeOperation = 'multiply';
      c.stroke();
      c.restore();
    }
  }

  // ── Soft edge feather — erases 1-2px outside squircle to anti-alias the clip ──
  // Uses destination-out on a slightly EXPANDED squircle inverted mask.
  // This removes hard pixel steps at the squircle boundary.
  {
    const featherCanvas = document.createElement('canvas');
    featherCanvas.width = featherCanvas.height = size;
    const fc = featherCanvas.getContext('2d')!;

    // Punch a squircle hole inside — everything outside the squircle stays
    fc.fillStyle = '#000000';
    fc.fillRect(0, 0, size, size);
    fc.globalCompositeOperation = 'destination-out';
    drawSquirclePath(fc, 0, 0, size);
    fc.fill();

    // Blur the mask so the edge erasure is feathered, not a hard cut.
    const featherPx = Math.max(1.2, size * 0.0015);
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = blurCanvas.height = size;
    const bc = blurCanvas.getContext('2d')!;
    bc.filter = `blur(${featherPx}px)`;
    bc.drawImage(featherCanvas, 0, 0);

    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(blurCanvas, 0, 0);
    c.restore();
  }

  // ── Atomic swap: resize output canvas and copy result in one operation ─────
  // Resizing here (not at the start) prevents a blank frame during async rendering.
  outputCanvas.width = outputCanvas.height = size;
  const outCtx = outputCanvas.getContext('2d');
  if (outCtx) outCtx.drawImage(masterCanvas, 0, 0);
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportIconPNG(
  layers: RenderContext['layers'],
  background: RenderContext['background'],
  lightAngle: number,
  mode: AppearanceMode,
  size = 1024,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  // Use appearanceMode, not 'mode', to fix the compile error that broke export
  await renderIconToCanvas(canvas, { layers, background, lightAngle, appearanceMode: mode, size });
  return canvas.toDataURL('image/png');
}

