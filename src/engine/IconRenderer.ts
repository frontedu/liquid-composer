import type { RenderContext, Layer, BackgroundConfig, AppearanceMode, LayerEffects } from '../types/index';
import type { LiquidGlassConfig } from '../types/index';
import { drawSquirclePath, createBackgroundCanvas } from './ImageProcessor';
import { LiquidGlassRenderer } from './LiquidGlass';
import type { LiquidGlassParams } from './LiquidGlass';
import { setWebgl2Status, setWebgl2Error } from '../store/uiStore';

const NEUTRAL_SHADOW_BG: BackgroundConfig = { type: 'solid', color: '#1c1c1e' };

export const DEFAULT_EFFECTS: LayerEffects = {
  domeIntensity: 30,
  domeRadius: 80,
  innerRimWidth: 2.1,
  innerRimLitAlpha: 65,
  innerRimShadowAlpha: 28,
  innerShadowWidth: 2.4,
  innerShadowAlpha: 18,
  outerBorderWidth: 0.16,
  outerBorderAlpha: 35,
  specularEdge: 40,
  rimIntensity: 22,
  envReflection: 0,
  innerGlow: 50,
  ambientRim: 42,
  aoDarken: 72,
  frostiness: 40,
  bevel: 7,
  refraction: 70,
};

// [1] INNER SPECULAR DOME — soft light filling the layer interior on the lit side
const LAYER_DOME_CENTER_ALPHA     = 0.18;  // brightness at the brightest point
const LAYER_DOME_MID_ALPHA        = 0.09;  // brightness halfway across
const LAYER_DOME_EDGE_ALPHA       = 0.05;  // brightness near the edge before fading out
const LAYER_DOME_BLUR_BASE        = 0.014;

// [2] INNER COLORED RIM — thin ring inside the layer edge, tinted with the layer color
const LAYER_INNER_RIM_MID_ALPHA   = 0.50;  // intensity in the middle
const LAYER_INNER_RIM_BLUR        = 0.0015;
const LAYER_INNER_RIM_ALPHA_BLUR  = 0.80;  // opacity of the blurred pass
const LAYER_INNER_RIM_ALPHA_SHARP = 0.45;  // opacity of the sharp pass layered on top
const LAYER_HOLES_RIM_ALPHA_BLUR  = 0.80;
const LAYER_HOLES_RIM_ALPHA_SHARP = 0.45;

// [4] INNER SHADOW — darkens the inner edge on the shadow side (concave depth)
const LAYER_INNER_SHADOW_MID_ALPHA   = 0.12;  // midpoint
const LAYER_INNER_SHADOW_BLUR        = 0.008;  // softness (× size)
const LAYER_INNER_SHADOW_ALPHA_BLUR  = 0.80;  // opacity of blurred pass
const LAYER_INNER_SHADOW_ALPHA_SHARP = 0.30;  // opacity of sharp pass

// [5] OUTER BORDER — thin ring outside the layer shape, colored with the layer's own color

const rasterCache = new Map<string, Promise<HTMLImageElement>>();

function loadRaster(url: string, rasterSize: number): Promise<HTMLImageElement> {
  const key = `${url}:${rasterSize}`;
  let pending = rasterCache.get(key);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image(rasterSize, rasterSize);
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    rasterCache.set(key, pending);
    pending.catch(() => rasterCache.delete(key));
    if (rasterCache.size > 32) rasterCache.delete(rasterCache.keys().next().value!);
  }
  return pending;
}

const bgCanvasCache = new Map<string, { canvas: HTMLCanvasElement; key: string }>();

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
  if (shadowCache.size > 16) {
    shadowCache.delete(shadowCache.keys().next().value!);
  }
  return canvas;
}

// ─── Shared tiny canvas for color sampling (avoids per-render allocation) ────
const _colorSampleCanvas = document.createElement('canvas');
_colorSampleCanvas.width = _colorSampleCanvas.height = 16;
const _colorSampleCtx = _colorSampleCanvas.getContext('2d')!;

const layerTintCache = new Map<string, { r: number; g: number; b: number }>();

function getCachedBgCanvas(bg: BackgroundConfig, size: number): { canvas: HTMLCanvasElement; key: string } {
  const key = `${size}:${JSON.stringify(bg)}`;
  const cached = bgCanvasCache.get(key);
  if (cached) return cached;
  const canvas = createBackgroundCanvas(bg as any, size, size);
  const entry = { canvas, key };
  bgCanvasCache.set(key, entry);
  if (bgCanvasCache.size > 8) {
    bgCanvasCache.delete(bgCanvasCache.keys().next().value!);
  }
  return entry;
}

let _glCanvas: HTMLCanvasElement | null = null;
let _glRenderer: LiquidGlassRenderer | null = null;
let _glSize = 0;
let _lastWebglError = '';

type ScratchCanvas = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
type ScratchPool = {
  getCanvas: (key: string, size: number) => ScratchCanvas;
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
  };
}

function reportWebglError(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  const short = raw.split('\n')[0].slice(0, 180);
  setWebgl2Error(short || 'Unknown WebGL2 error');
  if (raw && raw !== _lastWebglError) {
    console.error('WebGL2 error:', raw);
    _lastWebglError = raw;
  }
}

function getWebGLRenderer(size: number): LiquidGlassRenderer | null {
  try {
    if (!_glCanvas) {
      _glCanvas = document.createElement('canvas');
      _glCanvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        _glRenderer = null;
        _glSize = 0;
      });
    }
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

function mapTranslucency(value: number, enabled: boolean): number {
  if (!enabled) return 0;
  return Math.pow(Math.max(0, Math.min(1, value / 100)), 1.35);
}

function relativeLuminance(hex: string): number {
  const parse = (s: string) => parseInt(s, 16) / 255;
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const r = toLinear(parse(hex.slice(1, 3)));
  const g = toLinear(parse(hex.slice(3, 5)));
  const b = toLinear(parse(hex.slice(5, 7)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isDarkOnDark(hex: string): boolean {
  const bgLum = relativeLuminance('#1c1c1e'); // ≈ 0.012
  const fgLum = relativeLuminance(hex.replace(/^#/, '').length === 3
    ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex);
  const lighter = Math.max(fgLum, bgLum);
  const darker  = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05) < 2.0;
}

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
  if (bg.hue !== undefined && bg.tint !== undefined) {
    const hue = bg.hue;
    const saturation = Math.round(Math.max(0, 75 * (1 - bg.tint / 100)));
    return hslToRgb(hue, saturation, 12);
  }

  if (bg.colors && bg.colors[0]) {
    return parseHslString(bg.colors[0]) ?? { r: 0, g: 0, b: 20 };
  }

  return { r: 0, g: 0, b: 20 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function parseHslString(hsl: string): { r: number; g: number; b: number } | null {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (!m) return null;
  return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), 12); // use source hue/sat, force dark L
}

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

  const blurPx = sv * size * 0.05;
  const offsetY = sv * size * 0.022;
  const shadowAlpha = sv * 0.35;

  const { r, g, b } = shadowColorFromBackground(background);

  let fillR = r, fillG = g, fillB = b;
  if (layerConfig.fill.type === 'solid' && layerConfig.fill.color) {
    const hex = layerConfig.fill.color.replace('#', '');
    const fr = parseInt(hex.substring(0, 2), 16);
    const fg = parseInt(hex.substring(2, 4), 16);
    const fb = parseInt(hex.substring(4, 6), 16);
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
  rect: { cx: number; cy: number; half: number },
): void {
  const angleRad = (lightAngle * Math.PI) / 180;
  const lx = Math.cos(angleRad);
  const ly = -Math.sin(angleRad);
  const blurT = liquidGlass.blur?.enabled ? liquidGlass.blur.value / 100 : 0;
  const fx = { ...DEFAULT_EFFECTS, ...liquidGlass.effects };
  const rimLit = fx.innerRimLitAlpha / 100;
  const rimShadow = fx.innerRimShadowAlpha / 100;
  const half = Math.max(rect.half, 1);
  const fit = (dst: CanvasRenderingContext2D, src: CanvasImageSource, px: number) => {
    const k = 1 - px / half;
    dst.drawImage(src, rect.cx * (1 - k), rect.cy * (1 - k), size * k, size * k);
  };

  const layerColor = (() => {
    if (tintCacheKey) {
      const hit = layerTintCache.get(tintCacheKey);
      if (hit) return hit;
    }
    const s = 16;
    const tc = _colorSampleCtx;
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
  if (liquidGlass.specular) {
    const { canvas: domeCv, ctx: dc } = scratch.getCanvas('layer-dome', size);
    dc.drawImage(contentCanvas, 0, 0);
    dc.globalCompositeOperation = 'source-in';
    const litX = rect.cx + lx * rect.half * 0.84;
    const litY = rect.cy + ly * rect.half * 0.84;
    const grad = dc.createRadialGradient(litX, litY, 0, litX, litY, rect.half * 2 * (fx.domeRadius / 100));
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
    outCtx.globalAlpha = (fx.domeIntensity / 100);
    outCtx.filter = `blur(${blur}px)`;
    outCtx.drawImage(domeCv, 0, 0);
    outCtx.filter = 'none';
    outCtx.restore();
  }

  // ── [2] Inner colored rim (+ interior holes) ─────────────────────────────
  {
    const rimW = Math.max(3, size * (fx.innerRimWidth / 100) + blurT * size * 0.010);
    const blur = Math.max(0.6, size * LAYER_INNER_RIM_BLUR);

    const buildRimCanvas = (srcCanvas: HTMLCanvasElement, key: string, maskKey: string) => {
      const { canvas: rimCv, ctx: rc } = scratch.getCanvas(key, size);
      rc.drawImage(srcCanvas, 0, 0);
      const { canvas: mask, ctx: mc } = scratch.getCanvas(maskKey, size);
      mc.filter = `blur(${Math.max(1.2, rimW * 0.38)}px)`;
      fit(mc, srcCanvas, rimW / 2);
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(mask, 0, 0);
      rc.globalCompositeOperation = 'source-in';
      const grad = rc.createLinearGradient(
        (rect.cx + lx * rect.half), (rect.cy + ly * rect.half),
        (rect.cx - lx * rect.half), (rect.cy - ly * rect.half),
      );
      grad.addColorStop(0.00, lc(rimLit));
      grad.addColorStop(0.40, lc(LAYER_INNER_RIM_MID_ALPHA));
      grad.addColorStop(0.70, lc(rimShadow + 0.10));
      grad.addColorStop(1.00, lc(rimShadow));
      rc.fillStyle = grad;
      rc.fillRect(0, 0, size, size);
      return rimCv;
    };

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

    {
      const { canvas: holeCv, ctx: hc } = scratch.getCanvas('layer-holes', size);
      hc.fillStyle = 'rgba(255,255,255,1)';
      hc.fillRect(0, 0, size, size);
      hc.globalCompositeOperation = 'destination-out';
      hc.drawImage(contentCanvas, 0, 0);
      const { canvas: holeMask, ctx: hm } = scratch.getCanvas('layer-holes-mask', size);
      hm.filter = `blur(${Math.max(1.2, rimW * 0.38)}px)`;
      fit(hm, holeCv, rimW / 2);
      hc.globalCompositeOperation = 'destination-out';
      hc.drawImage(holeMask, 0, 0);
      const { canvas: dilCv, ctx: dc } = scratch.getCanvas('layer-holes-dilate', size);
      const dpad = rimW * 1.2;
      dc.filter = `blur(${rimW * 0.6}px)`;
      fit(dc, contentCanvas, -dpad);
      dc.filter = 'none';
      hc.globalCompositeOperation = 'destination-in';
      hc.drawImage(dilCv, 0, 0);
      const grad = hc.createLinearGradient(
        (rect.cx + lx * rect.half), (rect.cy + ly * rect.half),
        (rect.cx - lx * rect.half), (rect.cy - ly * rect.half),
      );
      grad.addColorStop(0.00, lc(rimLit));
      grad.addColorStop(0.40, lc(LAYER_INNER_RIM_MID_ALPHA));
      grad.addColorStop(1.00, lc(rimShadow));
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
    const darkW = Math.max(2, size * (fx.innerShadowWidth / 100) + blurT * size * 0.006);
    const { canvas: darkCv, ctx: dc } = scratch.getCanvas('layer-inner-shadow', size);
    dc.drawImage(contentCanvas, 0, 0);
    const { canvas: darkMask, ctx: dm } = scratch.getCanvas('layer-inner-shadow-mask', size);
    dm.filter = `blur(${Math.max(2, darkW * 0.55)}px)`;
    fit(dm, contentCanvas, darkW / 2);
    dc.globalCompositeOperation = 'destination-out';
    dc.drawImage(darkMask, 0, 0);
    dc.globalCompositeOperation = 'source-in';
    const grad = dc.createLinearGradient(
      (rect.cx - lx * rect.half), (rect.cy - ly * rect.half),
      (rect.cx + lx * rect.half), (rect.cy + ly * rect.half),
    );
    grad.addColorStop(0.00, `rgba(0,0,10,${(fx.innerShadowAlpha / 100)})`);
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
    const dilate = Math.max(1.5, size * (fx.outerBorderWidth / 100));
    const { canvas: outerCv, ctx: oc } = scratch.getCanvas('layer-outer-border', size);
    oc.filter = `blur(${Math.max(0.5, dilate * 0.5)}px)`;
    fit(oc, contentCanvas, -dilate);
    oc.filter = 'none';
    oc.globalCompositeOperation = 'destination-out';
    oc.drawImage(contentCanvas, 0, 0);
    oc.globalCompositeOperation = 'source-in';
    fit(oc, contentCanvas, -dilate);
    outCtx.save();
    outCtx.globalCompositeOperation = 'source-over';
    outCtx.globalAlpha = (fx.outerBorderAlpha / 100);
    outCtx.drawImage(outerCv, 0, 0);
    outCtx.restore();
  }
}

async function buildContentCanvas(
  layer: Layer,
  size: number,
  appearanceMode: AppearanceMode = 'default',
  softEdge = true,
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
    try {
      const img = await loadRaster(layer.blobUrl, Math.ceil(size / 512) * 512);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const sc = Math.min(size / iw, size / ih);
      const w = iw * sc;
      const h = ih * sc;
      const x = (size - w) / 2;
      const y = (size - h) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, w, h);

      ctx.globalCompositeOperation = 'source-atop';
      if (isClear) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
      } else if (isDark) {
        if (layer.fill.type === 'solid') {
          const fillColor = layer.fill.color ?? '#000000';
          ctx.fillStyle = isDarkOnDark(fillColor) ? '#ffffff' : fillColor;
          ctx.fillRect(0, 0, size, size);
        } else if (layer.fill.type === 'gradient' && 'stops' in layer.fill) {
          const grad = ctx.createLinearGradient(0, 0, 0, size);
          layer.fill.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, size, size);
        } else {
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
    } catch { }
  } else {
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
  }

  ctx.restore();
  if (!softEdge) return canvas;

  // ── Soft-edge pass: blur the content canvas by ~1px to smooth alpha edges ──
  const blurPx = Math.max(1.0, size * 0.0013);
  const softCanvas = document.createElement('canvas');
  softCanvas.width = softCanvas.height = size;
  const sc = softCanvas.getContext('2d')!;
  sc.filter = `blur(${blurPx}px)`;
  sc.drawImage(canvas, 0, 0);
  return softCanvas;
}

function drawContentFlat(outCtx: CanvasRenderingContext2D, contentCanvas: HTMLCanvasElement): void {
  outCtx.drawImage(contentCanvas, 0, 0);
}

async function renderLayerToCanvas(
  layer: Layer,
  size: number,
  mode: AppearanceMode,
  lightAngle: number,
  bgCanvas: HTMLCanvasElement,
  background: BackgroundConfig,
  scratch: ScratchPool,
  renderer: LiquidGlassRenderer | null,
  bgKey = '',
): Promise<HTMLCanvasElement | null> {
  if (!layer.visible) return null;

  const contentCanvas = await buildContentCanvas(layer, size, mode, layer.liquidGlass.enabled);
  const liquidGlass = layer.liquidGlass;

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const outCtx = out.getContext('2d')!;

  if (!liquidGlass.enabled) {
    drawContentFlat(outCtx, contentCanvas);
    return out;
  }

  const fillKey = layer.fill.type === 'solid' ? layer.fill.color : layer.fill.type === 'gradient' ? JSON.stringify(layer.fill.stops) : '';
  const tintKey = `${layer.id}:${mode}:${layer.blobUrl ?? ''}:${layer.fill.type}:${fillKey}`;
  const rect = { cx: size * (0.5 + layer.layout.x / 100), cy: size * (0.5 + layer.layout.y / 100), half: size * layer.layout.scale / 200 };
  const shadowBg = mode === 'dark' ? NEUTRAL_SHADOW_BG : background;

  const drawWithoutRefraction = () => {
    drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow, shadowBg, layer, scratch);
    drawContentFlat(outCtx, contentCanvas);
    drawLayerBevel(outCtx, contentCanvas, size, lightAngle, tintKey, liquidGlass, scratch, rect);
    return out;
  };

  if (!renderer) return drawWithoutRefraction();

  const fx = { ...DEFAULT_EFFECTS, ...liquidGlass.effects };
  const params: LiquidGlassParams = {
    blur: liquidGlass.blur.enabled ? liquidGlass.blur.value / 100 : 0.35,
    translucency: mapTranslucency(liquidGlass.translucency.value, liquidGlass.translucency.enabled),
    specular: liquidGlass.specular,
    specularIntensity: (liquidGlass.specularIntensity ?? 100) / 100,
    lightAngle,
    opacity: 1,
    mode: mode === 'dark' ? 1 : mode === 'clear' ? 2 : 0,
    darkAdjust: liquidGlass.dark?.enabled ? liquidGlass.dark.value / 100 : 0,
    monoAdjust: liquidGlass.mono?.enabled ? liquidGlass.mono.value / 100 : 0,
    aberration: (liquidGlass.aberration ?? 20) / 100,
    specularEdge: fx.specularEdge / 100,
    rimIntensity: fx.rimIntensity / 100,
    envReflection: fx.envReflection / 100,
    innerGlow: fx.innerGlow / 100,
    ambientRim: fx.ambientRim / 100,
    aoDarken: fx.aoDarken / 100,
    frostiness: fx.frostiness / 100,
    refraction: fx.refraction / 100,
    bevel: fx.bevel / 100,
    layerRect: [0.5 + layer.layout.x / 100, 0.5 + layer.layout.y / 100, layer.layout.scale / 200, layer.layout.scale / 200],
  };

  try {
    renderer.render(contentCanvas, bgCanvas, params, bgKey);
  } catch (err) {
    reportWebglError(err);
    return drawWithoutRefraction();
  }

  drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow, shadowBg, layer, scratch);

  outCtx.drawImage(renderer.canvas, 0, 0);

  drawLayerBevel(outCtx, contentCanvas, size, lightAngle, tintKey, liquidGlass, scratch, rect);

  return out;
}

function composite(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, alpha: number, blendMode: string): void {
  dst.save();
  dst.globalAlpha = alpha;
  dst.globalCompositeOperation = blendModeToCanvas(blendMode);
  dst.drawImage(src, 0, 0);
  dst.restore();
}

let renderChain: Promise<void> = Promise.resolve();

export function renderIconToCanvas(outputCanvas: HTMLCanvasElement, ctx: RenderContext): Promise<void> {
  const run = renderChain.then(() => renderIconToCanvasImpl(outputCanvas, ctx));
  renderChain = run.catch(() => {});
  return run;
}

async function renderIconToCanvasImpl(
  outputCanvas: HTMLCanvasElement,
  ctx: RenderContext,
): Promise<void> {
  const { layers, background, lightAngle, appearanceMode, size } = ctx;

  const renderer = getWebGLRenderer(size);
  if (renderer) setWebgl2Status('active');
  const scratch = createScratchPool();

  // ── Double-buffering: render into scratch canvas, swap atomically at end ──
  const { canvas: masterCanvas, ctx: c } = getScratchCanvas('master-buffer', size);

  const darkBg: BackgroundConfig = { type: 'solid', color: '#1c1c1e', colors: ['#1c1c1e', '#1c1c1e'], hue: 0, tint: 0 };
  const clearBg: BackgroundConfig = { type: 'solid', color: 'rgba(230,230,235,1)', colors: ['rgba(230,230,235,1)', 'rgba(230,230,235,1)'], hue: 0, tint: 0 };
  const { canvas: bgCanvas, key: bgKey } = appearanceMode === 'dark'
    ? getCachedBgCanvas(darkBg, size)
    : getCachedBgCanvas(background, size);

  const { canvas: glassBgCanvas, key: glassBgKey } = appearanceMode === 'clear'
    ? getCachedBgCanvas(clearBg, size)
    : { canvas: bgCanvas, key: bgKey };

  // ── Squircle drop shadow (default/dark only — clear mode exports as transparent PNG) ──
  if (appearanceMode !== 'clear') {
    const { r: sr, g: sg, b: sb } = appearanceMode === 'dark'
      ? { r: 0, g: 0, b: 0 }
      : shadowColorFromBackground(background);
    c.save();
    c.shadowColor = `rgba(${sr},${sg},${sb},0.48)`;
    c.shadowBlur = size * 0.055;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = size * 0.022;
    drawSquirclePath(c, 0, 0, size);
    c.fillStyle = '#000000';
    c.fill();
    c.restore();
  }

  c.save();
  drawSquirclePath(c, 0, 0, size);
  c.clip();

  if (appearanceMode !== 'clear') {
    c.drawImage(bgCanvas, 0, 0, size, size);
  }

  const rootLayers = [...layers]
    .filter((l) => l.visible && l.parentId === null)
    .sort((a, b) => a.order - b.order);
  let paintIndex = 0;

  const runningBg = document.createElement('canvas');
  runningBg.width = runningBg.height = size;
  const rbCtx = runningBg.getContext('2d')!;
  rbCtx.drawImage(glassBgCanvas, 0, 0);

  for (const layer of rootLayers) {
    const feedBg = layer.liquidGlass?.enabled ? runningBg : glassBgCanvas;

    if (layer.type === 'group') {
      const children = [...layers]
        .filter((l) => l.parentId === layer.id && l.visible)
        .sort((a, b) => a.order - b.order);


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
          renderer,
          paintIndex++ === 0 ? glassBgKey : '',
        );
        if (lc) {
          composite(gc, lc, child.opacity / 100, child.blendMode);
          composite(rbCtx, lc, (child.opacity / 100) * (layer.opacity / 100), 'normal');
        }
      }

      composite(c, groupCanvas, layer.opacity / 100, 'normal');
    } else {
      const lc = await renderLayerToCanvas(
        layer,
        size,
        appearanceMode,
        lightAngle,
        feedBg,
        background,
        scratch,
        renderer,
        paintIndex++ === 0 ? glassBgKey : '',
      );
      if (lc) {
        composite(c, lc, layer.opacity / 100, layer.blendMode);
        composite(rbCtx, lc, layer.opacity / 100, 'normal');
      }
    }
  }

  c.restore(); // end squircle clip

  {
    const angleRad = (lightAngle * Math.PI) / 180;
    const lx = Math.cos(angleRad);
    const ly = -Math.sin(angleRad);

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

      const avg = (r + g + b) / 3;
      r = Math.min(255, Math.max(0, Math.round(avg + (r - avg) * 1.5)));
      g = Math.min(255, Math.max(0, Math.round(avg + (g - avg) * 1.5)));
      b = Math.min(255, Math.max(0, Math.round(avg + (b - avg) * 1.5)));

      const mix = 0.25;
      return {
        r: Math.round(r + (255 - r) * mix),
        g: Math.round(g + (255 - g) * mix),
        b: Math.round(b + (255 - b) * mix),
      };
    })();
    const bg = (a: number) => `rgba(${bgSample.r},${bgSample.g},${bgSample.b},${a})`;

    // [A] Inner colored rim
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
  {
    const featherCanvas = document.createElement('canvas');
    featherCanvas.width = featherCanvas.height = size;
    const fc = featherCanvas.getContext('2d')!;

    fc.fillStyle = '#000000';
    fc.fillRect(0, 0, size, size);
    fc.globalCompositeOperation = 'destination-out';
    drawSquirclePath(fc, 0, 0, size);
    fc.fill();

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
  outputCanvas.width = outputCanvas.height = size;
  const outCtx = outputCanvas.getContext('2d');
  if (outCtx) outCtx.drawImage(masterCanvas, 0, 0);
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';
export interface ExportOptions { format: ExportFormat; size: number }

const EXPORT_QUALITY = 0.95;

function downscale(source: HTMLCanvasElement, target: number): HTMLCanvasElement {
  let current = source;
  while (current.width > target) {
    const next = Math.max(target, Math.floor(current.width / 2));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = next;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, next, next);
    current = canvas;
  }
  return current;
}

export async function exportIcon(
  layers: RenderContext['layers'],
  background: RenderContext['background'],
  lightAngle: number,
  mode: AppearanceMode,
  { format, size }: ExportOptions = { format: 'png', size: 1024 },
): Promise<Blob> {
  const renderSize = Math.max(size, Math.min(2048, Math.max(1024, size * 2)));
  const rendered = document.createElement('canvas');
  await renderIconToCanvas(rendered, { layers, background, lightAngle, appearanceMode: mode, size: renderSize });
  const canvas = downscale(rendered, size);
  if (format === 'jpeg') {
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, EXPORT_QUALITY));
  if (!blob) throw new Error(`Export failed for image/${format}`);
  return blob;
}
