import type { RenderContext, Layer, BackgroundConfig, AppearanceMode } from '../types/index';
import type { LiquidGlassConfig } from '../types/index';
import { drawSquirclePath, createBackgroundCanvas } from './ImageProcessor';
import { LiquidGlassRenderer } from './LiquidGlass';
import type { LiquidGlassParams } from './LiquidGlass';
import { setWebgl2Status, setWebgl2Error } from '../store/uiStore';

// ─── Image cache ──────────────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();

async function getCachedImage(url: string): Promise<HTMLImageElement> {
  if (imageCache.has(url)) return imageCache.get(url)!;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageCache.set(url, img); resolve(img); };
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
function shadowColorFromBackground(bg: BackgroundConfig): { r: number; g: number; b: number } {
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

  const { canvas: shadowCanvas, ctx: sc } = scratch.getCanvas('drop-shadow', size);
  sc.save();
  sc.filter = `blur(${blurPx}px)`;
  sc.globalAlpha = shadowAlpha;
  sc.drawImage(contentCanvas, 0, offsetY);
  sc.restore();
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = `rgb(${fillR}, ${fillG}, ${fillB})`;
  sc.fillRect(0, 0, size, size);

  outCtx.drawImage(shadowCanvas, 0, 0);

}

/**
 * 3D bevel edge for individual layers — two passes:
 *  1. Inner bright rim  — eroded ring colored white on the lit side (screen)
 *  2. Dark outer border — dilated-minus-original ring darkened on shadow side (multiply)
 *
 * Together they produce the characteristic liquid glass "raised button" depth
 * on arbitrary layer shapes, independent of the squircle container rim.
 */
function drawLayerBevel(
  outCtx: CanvasRenderingContext2D,
  contentCanvas: HTMLCanvasElement,
  size: number,
  lightAngle: number,
  liquidGlass: LiquidGlassConfig,
  scratch: ScratchPool,
): void {
  const angleRad = (lightAngle * Math.PI) / 180;
  const lx = Math.cos(angleRad);
  const ly = -Math.sin(angleRad);

  // Both rings are built as INSET erosions so their outer edge is always the
  // content's own alpha boundary (already AA from buildContentCanvas soft-blur).
  // This guarantees zero aliasing on the outer edge of both rings.
  // Only the inner edge of each ring needs a blur, which we apply to the erode
  // mask BEFORE subtraction — never to the colored result (avoids ghosting).
  const blurT = liquidGlass.blur?.enabled ? liquidGlass.blur.value / 100 : 0;
  const transT = mapTranslucency(
    liquidGlass.translucency?.value ?? 55,
    !!liquidGlass.translucency?.enabled,
    0.55,
  );
  // Thicker, softer rims for Liquid Glass layers (more depth, less "rigid")
  const bevelWidth = size * (0.018 + blurT * 0.014 + (1 - transT) * 0.007);
  const erodeRim  = Math.max(3.5, bevelWidth);
  const erodeDark = Math.max(2.6, bevelWidth * 0.7);
  // Stronger baseline blur so the rim is visibly soft even with blur=0
  const rimBlur  = Math.max(3.4, size * 0.0042 + blurT * size * 0.006);
  const darkBlur = Math.max(2.0, size * 0.0030 + blurT * size * 0.0035);

  // ── Pass 1: Inner bright rim (lit side, convex curved gradient) ───────────
  {
    const { canvas: ringCanvas, ctx: rc } = scratch.getCanvas('bevel-rim', size);

    // Outer edge = content boundary (AA inherited, no extra work needed)
    rc.drawImage(contentCanvas, 0, 0);

    // Inner edge = eroded content blurred → smooth fade into glass body
    const { canvas: innerMask, ctx: im } = scratch.getCanvas('bevel-rim-mask', size);
    im.filter = `blur(${Math.max(1.5, erodeRim * 0.575)}px)`;
    im.drawImage(contentCanvas, erodeRim / 2, erodeRim / 2, size - erodeRim, size - erodeRim);
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(innerMask, 0, 0);

    // Curved surface gradient: convex highlight that tapers off naturally
    // Uses both a radial glow from the lit corner AND a directional gradient
    rc.globalCompositeOperation = 'source-in';

    // Primary: radial glow from lit corner (convex catch-light)
    // Radius kept tight (0.38) so the glow stays near the lit edge, not flooding the interior
    const litCornerX = size * (0.5 + lx * 0.45);
    const litCornerY = size * (0.5 + ly * 0.45);
    const radGrad = rc.createRadialGradient(litCornerX, litCornerY, 0, litCornerX, litCornerY, size * 0.38);
    radGrad.addColorStop(0.00, 'rgba(255,255,255,0.22)');
    radGrad.addColorStop(0.20, 'rgba(255,255,255,0.10)');
    radGrad.addColorStop(0.50, 'rgba(255,255,255,0.02)');
    radGrad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    rc.fillStyle = radGrad;
    rc.fillRect(0, 0, size, size);

    // Secondary: subtle directional gradient for falloff continuity
    rc.globalCompositeOperation = 'lighter';
    const litGrad = rc.createLinearGradient(
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
      size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
    );
    litGrad.addColorStop(0.00, 'rgba(255,255,255,0.06)');
    litGrad.addColorStop(0.25, 'rgba(255,255,255,0.02)');
    litGrad.addColorStop(0.60, 'rgba(255,255,255,0.00)');
    litGrad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    rc.fillStyle = litGrad;
    rc.fillRect(0, 0, size, size);

    // Soft blur pass for inner rim (visible softness)
    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.globalAlpha = 0.50;
    outCtx.filter = `blur(${rimBlur}px)`;
    outCtx.drawImage(ringCanvas, 0, 0);
    outCtx.filter = 'none';
    outCtx.globalAlpha = 0.18;
    outCtx.drawImage(ringCanvas, 0, 0);
    outCtx.restore();
  }

  // ── Pass 1b: Thin sharp inner ridge (adds crisp 3D edge without blur)
  {
    const crispWidth = Math.max(1.2, bevelWidth * 0.4);
    const { canvas: sharpCanvas, ctx: sc } = scratch.getCanvas('bevel-rim-sharp', size);

    sc.drawImage(contentCanvas, 0, 0);

    const { canvas: sharpMask, ctx: sm } = scratch.getCanvas('bevel-rim-sharp-mask', size);
    sm.filter = `blur(${Math.max(0.8, crispWidth * 0.35)}px)`;
    sm.drawImage(contentCanvas, crispWidth / 2, crispWidth / 2, size - crispWidth, size - crispWidth);
    sc.globalCompositeOperation = 'destination-out';
    sc.drawImage(sharpMask, 0, 0);

    sc.globalCompositeOperation = 'source-in';
    const sharpGrad = sc.createLinearGradient(
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
      size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
    );
    sharpGrad.addColorStop(0.00, 'rgba(255,255,255,0.35)');
    sharpGrad.addColorStop(0.20, 'rgba(255,255,255,0.14)');
    sharpGrad.addColorStop(0.50, 'rgba(255,255,255,0.02)');
    sharpGrad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    sc.fillStyle = sharpGrad;
    sc.fillRect(0, 0, size, size);

    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.globalAlpha = 0.45;
    outCtx.filter = 'none';
    outCtx.drawImage(sharpCanvas, 0, 0);
    outCtx.restore();
  }

  // ── Pass 2: Dark outer border (shadow side, concave curved gradient) ─────
  // Non-linear (cubic) falloff for more natural shadow appearance
  {
    const { canvas: ringCanvas, ctx: rc } = scratch.getCanvas('bevel-dark', size);

    // Outer edge = content boundary
    rc.drawImage(contentCanvas, 0, 0);

    // Inner edge = deeper erosion, blurred for soft falloff toward center
    const { canvas: innerMask, ctx: im } = scratch.getCanvas('bevel-dark-mask', size);
    im.filter = `blur(${Math.max(2.5, erodeDark * 0.6325)}px)`;
    im.drawImage(contentCanvas, erodeDark / 2, erodeDark / 2, size - erodeDark, size - erodeDark);
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(innerMask, 0, 0);

    // Concave curved shadow: radial from shadow corner + directional
    rc.globalCompositeOperation = 'source-in';

    // Radial shadow anchor from the shadow corner
    const shadowCornerX = size * (0.5 - lx * 0.45);
    const shadowCornerY = size * (0.5 - ly * 0.45);
    const shadRadGrad = rc.createRadialGradient(
      shadowCornerX, shadowCornerY, 0, shadowCornerX, shadowCornerY, size * 0.65
    );
    shadRadGrad.addColorStop(0.00, 'rgba(0,0,15,0.38)');
    shadRadGrad.addColorStop(0.18, 'rgba(0,0,15,0.20)');
    shadRadGrad.addColorStop(0.45, 'rgba(0,0,15,0.06)');
    shadRadGrad.addColorStop(1.00, 'rgba(0,0,15,0.00)');
    rc.fillStyle = shadRadGrad;
    rc.fillRect(0, 0, size, size);

    // Directional supplement for uniform shadow edge
    rc.globalCompositeOperation = 'lighter';
    const darkGrad = rc.createLinearGradient(
      size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
    );
    darkGrad.addColorStop(0.00, 'rgba(0,0,15,0.15)');
    darkGrad.addColorStop(0.25, 'rgba(0,0,15,0.06)');
    darkGrad.addColorStop(0.50, 'rgba(0,0,15,0.0)');
    rc.fillStyle = darkGrad;
    rc.fillRect(0, 0, size, size);

    outCtx.save();
    outCtx.globalCompositeOperation = 'multiply';
    // Soft shadowed rim (blur-heavy, low sharpness)
    outCtx.globalAlpha = 0.85;
    outCtx.filter = `blur(${darkBlur}px)`;
    outCtx.drawImage(ringCanvas, 0, 0);
    outCtx.filter = 'none';
    outCtx.globalAlpha = 0.35;
    outCtx.drawImage(ringCanvas, 0, 0);
    outCtx.restore();
  }

  // ── Pass 3: External border — thin outline OUTSIDE the layer shape ────────
  // Built by: drawing content slightly oversized (dilation) then subtracting
  // the original to get a thin ring just outside the content boundary.
  // Composited with source-over so it draws on whatever is underneath.
  {
    const dilate = Math.max(1, size * 0.0015); // Thinner: ~1.5px at 1024
    const { canvas: ringCanvas, ctx: rc } = scratch.getCanvas('bevel-outer', size);

    // Outer ring = slightly expanded content (dilated by drawing larger, centered)
    const expand = dilate * 2;
    rc.filter = `blur(${dilate * 0.12}px)`;
    rc.drawImage(contentCanvas, -dilate, -dilate, size + expand, size + expand);
    rc.filter = 'none';

    // Subtract original to keep only the outer fringe
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(contentCanvas, 0, 0);

    // Color: very subtle dark fringe
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = 'rgba(0,0,0,0.10)';
    rc.fillRect(0, 0, size, size);

    outCtx.save();
    outCtx.globalCompositeOperation = 'source-over';
    outCtx.drawImage(ringCanvas, 0, 0);
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
    const specGrad = sc.createRadialGradient(hx, hy, 0, hx, hy, size * 0.24);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      specGrad.addColorStop(t, `rgba(255,255,255,${(0.40 * Math.pow(1 - t, 4.2)).toFixed(3)})`);
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
    rimGrad.addColorStop(0.00, 'rgba(255,255,255,0.30)');
    rimGrad.addColorStop(0.22, 'rgba(255,255,255,0.09)');
    rimGrad.addColorStop(0.55, 'rgba(255,255,255,0.01)');
    rimGrad.addColorStop(1.00, 'rgba(255,255,255,0.04)');

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
    ic.fillStyle = 'rgba(255,255,255,0.22)';
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
    const erodeGlow = Math.max(3, size * 0.015);
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
    glowGrad.addColorStop(0.00, `rgba(${glowColor},0.35)`);
    glowGrad.addColorStop(0.30, `rgba(${glowColor},0.15)`);
    glowGrad.addColorStop(0.60, `rgba(${glowColor},0.04)`);
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
    dimGrad.addColorStop(0.00, `rgba(0,0,0,${(0.12 * translucency).toFixed(3)})`);
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
  drawLayerBevel(outCtx, contentCanvas, size, lightAngle, liquidGlass, scratch);

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
    innerGrad.addColorStop(0.6, dark ? 'rgba(0,0,20,0.18)' : 'rgba(0,0,20,0.06)');
    innerGrad.addColorStop(1.0, dark ? 'rgba(0,0,20,0.45)' : 'rgba(0,0,20,0.18)');
    
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

      // Draw image first (establishes the alpha mask shape)
      ctx.drawImage(img, x, y, w, h);

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

      renderer.render(contentCanvas, bgCanvas, params);
      setWebgl2Status('active');

      // ── Drop shadow (Canvas 2D, pre-glass) ────────────────────────────────
      drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow, background, layer, scratch);

      // ── WebGL glass result ────────────────────────────────────────────────
      outCtx.save();
      outCtx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);
      outCtx.drawImage(_glCanvas, 0, 0);
      outCtx.restore();

      // ── Layer bevel (inner bright rim + dark outer border) ────────────────
      drawLayerBevel(outCtx, contentCanvas, size, lightAngle, liquidGlass, scratch);

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
  const c = outputCanvas.getContext('2d');
  if (!c) return;

  // Reset per-render WebGL indicator (set to active if any layer uses WebGL).
  setWebgl2Status('inactive');
  const scratch = createScratchPool();
  const specularLayerId = findSpecularLayerId(layers);

  outputCanvas.width = outputCanvas.height = size;
  c.clearRect(0, 0, size, size);

  // Build base background canvas
  // Dark mode: always use the Apple dark system background (#1C1C1E) regardless of bg config
  const bgCanvas = appearanceMode === 'dark'
    ? (() => {
        const cb = document.createElement('canvas');
        cb.width = cb.height = size;
        cb.getContext('2d')!.fillStyle = '#1c1c1e';
        cb.getContext('2d')!.fillRect(0, 0, size, size);
        return cb;
      })()
    : createBackgroundCanvas(background as any, size, size);

  // For glass blur in clear mode, use a neutral light background (simulates wallpaper)
  // The actual icon composite will be on transparent — bgCanvas only feeds the glass blur
  const glassBgCanvas = appearanceMode === 'clear'
    ? (() => {
        const cb = document.createElement('canvas');
        cb.width = cb.height = size;
        const cc = cb.getContext('2d')!;
        cc.fillStyle = 'rgba(230,230,235,1)';
        cc.fillRect(0, 0, size, size);
        return cb;
      })()
    : bgCanvas;


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
      );
      if (lc) {
        c.drawImage(lc, 0, 0);
        // Update running bg with this layer's output for subsequent layers
        rbCtx.drawImage(lc, 0, 0);
      }
    }
  }

  c.restore(); // end squircle clip

  // ── Squircle glass rim — 3 passes for physical 3D bevel depth ────────────
  //
  //  The characteristic liquid glass edge has two components:
  //    • Inner bright rim  — light catching the inward-facing bevel on the lit side
  //    • Outer dark border — shadow occlusion on the boundary of the shadow side
  //  Together they create the "raised button" 3D illusion seen in iOS Liquid Glass.
  //
  {
    const angleRad = (lightAngle * Math.PI) / 180;
    const lx = Math.cos(angleRad);
    const ly = -Math.sin(angleRad);

      // 1. Inner bright rim — INSIDE the shape on the lit side.
      //    Stroke is drawn on a slightly smaller squircle so it sits fully inside
      //    the glass surface, simulating a bevelled edge catching the light.
      {
        const inset = Math.max(3.5, size * 0.0055); // ~5.6px at 1024 (thicker inner rim)
        const rimBlur = Math.max(2.0, size * 0.0028); // stronger blur for visible softness
        c.save();
        c.translate(inset, inset);
        c.filter = `blur(${rimBlur}px)`;
        const innerRimGrad = c.createLinearGradient(
          size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
          size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5)
        );
        innerRimGrad.addColorStop(0.00, 'rgba(255,255,255,0.78)');
        innerRimGrad.addColorStop(0.28, 'rgba(255,255,255,0.40)');
        innerRimGrad.addColorStop(0.60, 'rgba(255,255,255,0.10)');
        innerRimGrad.addColorStop(1.00, 'rgba(255,255,255,0.0)');
        drawSquirclePath(c, 0, 0, size - inset * 2);
        c.strokeStyle = innerRimGrad;
        c.lineWidth = Math.max(3.5, size * 0.0055);
        c.globalCompositeOperation = 'screen';
        c.stroke();
        c.restore();
      }

    // 2. Focused specular glare — tight bright hotspot on the lit corner.
    //    Offset angle slightly to simulate the inner bevel's steeper face.
    {
      const glx = Math.cos(angleRad + 0.15);
      const gly = -Math.sin(angleRad + 0.15);
      const inset = Math.max(1.2, size * 0.0025);
      c.save();
      c.translate(inset, inset);
      const glareGrad = c.createLinearGradient(
        size * (0.5 + glx * 0.5), size * (0.5 + gly * 0.5),
        size * 0.5, size * 0.5
      );
      glareGrad.addColorStop(0.00, 'rgba(255,255,255,0.85)');
      glareGrad.addColorStop(0.10, 'rgba(255,255,255,0.32)');
      glareGrad.addColorStop(0.28, 'rgba(255,255,255,0.0)');
      drawSquirclePath(c, 0, 0, size - inset * 2);
      c.strokeStyle = glareGrad;
      c.lineWidth = Math.max(1.0, size * 0.0015);
      c.globalCompositeOperation = 'screen';
      c.stroke();
      c.restore();
    }

    // 3. Secondary ambient rim — shadow side, opposite the light.
    //    Simulates bounce/fill light wrapping around the back edge of the glass,
    //    just like the Apple official icon style where BOTH corners catch light.
    {
      const inset = Math.max(3.5, size * 0.0055);
      c.save();
      c.translate(inset, inset);
      c.filter = `blur(${Math.max(1.5, size * 0.003)}px)`;
      // Gradient runs from shadow corner (opposite light) → center, fades out quickly
      const ambientGrad = c.createLinearGradient(
        size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
        size * (0.5 + lx * 0.15), size * (0.5 + ly * 0.15),
      );
      ambientGrad.addColorStop(0.00, 'rgba(255,255,255,0.32)');
      ambientGrad.addColorStop(0.22, 'rgba(255,255,255,0.12)');
      ambientGrad.addColorStop(0.50, 'rgba(255,255,255,0.02)');
      ambientGrad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
      drawSquirclePath(c, 0, 0, size - inset * 2);
      c.strokeStyle = ambientGrad;
      c.lineWidth = Math.max(2.5, size * 0.004);
      c.globalCompositeOperation = 'screen';
      c.stroke();
      c.restore();
    }

    // 4. Dark outer border — AT the shape boundary on the shadow side.
    {
      const darkGrad = c.createLinearGradient(
        size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
        size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5)
      );
      darkGrad.addColorStop(0.00, 'rgba(0,0,15,0.34)');
      darkGrad.addColorStop(0.28, 'rgba(0,0,15,0.12)');
      darkGrad.addColorStop(0.55, 'rgba(0,0,15,0.0)');
      c.save();
      drawSquirclePath(c, 0, 0, size);
      c.strokeStyle = darkGrad;
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

