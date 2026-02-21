import type { RenderContext, Layer, BackgroundConfig, AppearanceMode } from '../types/index';
import type { LiquidGlassConfig } from '../types/index';
import { drawSquirclePath, createBackgroundCanvas } from './ImageProcessor';
import { LiquidGlassRenderer } from './LiquidGlass';
import type { LiquidGlassParams } from './LiquidGlass';

// ─── Image cache ──────────────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();

async function getCachedImage(url: string): Promise<HTMLImageElement> {
  if (imageCache.has(url)) return imageCache.get(url)!;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { imageCache.set(url, img); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── WebGL singleton ──────────────────────────────────────────────────────────

let _glCanvas: HTMLCanvasElement | null = null;
let _glRenderer: LiquidGlassRenderer | null = null;

function getWebGLRenderer(size: number): LiquidGlassRenderer | null {
  try {
    if (!_glCanvas) _glCanvas = document.createElement('canvas');
    _glCanvas.width  = size;
    _glCanvas.height = size;
    if (!_glRenderer) _glRenderer = new LiquidGlassRenderer(_glCanvas);
    return _glRenderer;
  } catch {
    return null;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

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
  return mode === 'dark' || mode === 'clear-dark' || mode === 'tinted-dark';
}

// ─── Canvas 2D Liquid Glass helper passes ─────────────────────────────────────

/**
 * Drop shadow — neutral or chromatic.
 * Draws to `outCtx` BEFORE the glass content (back-most layer).
 */
function drawDropShadow(
  outCtx: CanvasRenderingContext2D,
  contentCanvas: HTMLCanvasElement,
  size: number,
  shadow: LiquidGlassConfig['shadow'],
): void {
  if (!shadow.enabled || shadow.value <= 0) return;

  const sv       = shadow.value / 100;
  const blurPx   = sv * size * 0.05;
  const offsetY  = sv * size * 0.022;
  const alpha    = sv * 0.55;

  if (shadow.type === 'chromatic') {
    // Two passes with colour-shifted offsets, blended with screen.

    // ── Blue/violet shadow ────────────────────────────────────────────────
    const blueCanvas = document.createElement('canvas');
    blueCanvas.width = blueCanvas.height = size;
    const bc = blueCanvas.getContext('2d')!;
    bc.save();
    bc.filter = `blur(${blurPx * 1.3}px)`;
    bc.globalAlpha = alpha * 0.70;
    bc.drawImage(contentCanvas, -size * 0.005, offsetY);
    bc.restore();
    bc.globalCompositeOperation = 'source-in';
    bc.fillStyle = 'rgba(15, 20, 120, 1)';
    bc.fillRect(0, 0, size, size);

    // ── Warm/magenta shadow ───────────────────────────────────────────────
    const redCanvas = document.createElement('canvas');
    redCanvas.width = redCanvas.height = size;
    const rc = redCanvas.getContext('2d')!;
    rc.save();
    rc.filter = `blur(${blurPx}px)`;
    rc.globalAlpha = alpha * 0.50;
    rc.drawImage(contentCanvas, size * 0.005, offsetY * 1.1);
    rc.restore();
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = 'rgba(160, 20, 60, 1)';
    rc.fillRect(0, 0, size, size);

    // Merge: blue base + red as screen
    bc.globalCompositeOperation = 'screen';
    bc.drawImage(redCanvas, 0, 0);

    outCtx.drawImage(blueCanvas, 0, 0);
  } else {
    // ── Neutral shadow ────────────────────────────────────────────────────
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = size;
    const sc = shadowCanvas.getContext('2d')!;
    sc.save();
    sc.filter = `blur(${blurPx}px)`;
    sc.globalAlpha = alpha;
    sc.drawImage(contentCanvas, 0, offsetY);
    sc.restore();
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = 'rgba(0, 0, 30, 1)';
    sc.fillRect(0, 0, size, size);

    outCtx.drawImage(shadowCanvas, 0, 0);
  }
}

/**
 * Gradient border — bright on the lit side, dim on the shadow side.
 * Uses erosion to isolate the edge ring of the content shape.
 */
function drawBorderGradient(
  outCtx: CanvasRenderingContext2D,
  contentCanvas: HTMLCanvasElement,
  size: number,
  lightAngle: number,
): void {
  const angleRad = (lightAngle * Math.PI) / 180;
  const lx = Math.cos(angleRad);
  const ly = -Math.sin(angleRad); // canvas Y is inverted

  const borderCanvas = document.createElement('canvas');
  borderCanvas.width = borderCanvas.height = size;
  const bc = borderCanvas.getContext('2d')!;

  // Full content → then erode interior
  bc.drawImage(contentCanvas, 0, 0);
  const erode = Math.max(2, size * 0.011);
  bc.globalCompositeOperation = 'destination-out';
  bc.drawImage(contentCanvas, erode / 2, erode / 2, size - erode, size - erode);

  // Colour the remaining edge ring with a directional gradient
  bc.globalCompositeOperation = 'source-in';
  const gx1 = size * (0.5 + lx * 0.5);
  const gy1 = size * (0.5 + ly * 0.5);
  const gx2 = size * (0.5 - lx * 0.5);
  const gy2 = size * (0.5 - ly * 0.5);
  const bg = bc.createLinearGradient(gx1, gy1, gx2, gy2);
  bg.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  bg.addColorStop(0.30, 'rgba(255,255,255,0.55)');
  bg.addColorStop(0.65, 'rgba(255,255,255,0.22)');
  bg.addColorStop(1.00, 'rgba(255,255,255,0.08)');
  bc.fillStyle = bg;
  bc.fillRect(0, 0, size, size);

  outCtx.save();
  outCtx.globalCompositeOperation = 'screen';
  outCtx.drawImage(borderCanvas, 0, 0);
  outCtx.restore();
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
): Promise<void> {
  const dark         = isDarkMode(mode);
  const angleRad     = (lightAngle * Math.PI) / 180;
  const lx           = Math.cos(angleRad);
  const ly           = -Math.sin(angleRad);
  const translucency = liquidGlass.translucency.enabled ? liquidGlass.translucency.value / 100 : 0.50;
  const blurRadius   = liquidGlass.blur.enabled ? (liquidGlass.blur.value / 100) * 28 : 14;

  // ── 1. Drop shadow ────────────────────────────────────────────────────────
  drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow);

  // ── 2. Blurred background clipped to content shape ────────────────────────
  {
    const blurredBg = document.createElement('canvas');
    blurredBg.width = blurredBg.height = size;
    const bb = blurredBg.getContext('2d')!;
    bb.filter = `blur(${blurRadius}px) saturate(145%)`;
    bb.drawImage(bgCanvas, 0, 0);
    bb.filter = 'none';

    // Clip to content alpha
    const clipped = document.createElement('canvas');
    clipped.width = clipped.height = size;
    const cc = clipped.getContext('2d')!;
    cc.drawImage(blurredBg, 0, 0);
    cc.globalCompositeOperation = 'destination-in';
    cc.drawImage(contentCanvas, 0, 0);

    // Tint overlay (clipped)
    cc.globalCompositeOperation = 'source-over';
    const tintAlpha = dark ? 0.18 : 0.10;
    const tintColor = dark ? `rgba(10,10,22,${tintAlpha})` : `rgba(255,255,255,${tintAlpha})`;
    const tintCanvas = document.createElement('canvas');
    tintCanvas.width = tintCanvas.height = size;
    const tc = tintCanvas.getContext('2d')!;
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
    const contentAlpha = Math.max(0.15, 1.0 - translucency * 0.6);
    outCtx.save();
    outCtx.globalAlpha = contentAlpha * (layerOpacity / 100);
    outCtx.globalCompositeOperation = blendModeToCanvas(layerBlendMode);
    outCtx.drawImage(contentCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 4. Specular highlight (gamma-sharpened radial) ────────────────────────
  if (liquidGlass.specular) {
    const hx = size * (0.5 + lx * 0.30);
    const hy = size * (0.5 + ly * 0.30);

    const specCanvas = document.createElement('canvas');
    specCanvas.width = specCanvas.height = size;
    const sc = specCanvas.getContext('2d')!;

    // Primary concentrated highlight
    const specGrad = sc.createRadialGradient(hx, hy, 0, hx, hy, size * 0.58);
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      specGrad.addColorStop(t, `rgba(255,255,255,${(0.82 * Math.pow(1 - t, 5.0)).toFixed(3)})`);
    }
    sc.fillStyle = specGrad;
    sc.fillRect(0, 0, size, size);

    // Secondary top-edge strip (Apple curved-glass characteristic)
    const topGrad = sc.createLinearGradient(0, size * 0.78, 0, size * 0.88);
    topGrad.addColorStop(0, 'rgba(255,255,255,0)');
    topGrad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    topGrad.addColorStop(1, 'rgba(255,255,255,0)');
    sc.globalCompositeOperation = 'source-over';
    sc.fillStyle = topGrad;
    sc.fillRect(0, size * 0.78, size, size * 0.10);

    // Clip to content shape
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(contentCanvas, 0, 0);

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

    const rimCanvas = document.createElement('canvas');
    rimCanvas.width = rimCanvas.height = size;
    const rc = rimCanvas.getContext('2d')!;

    const rimGrad = rc.createLinearGradient(gx1, gy1, gx2, gy2);
    rimGrad.addColorStop(0.00, 'rgba(255,255,255,0.60)');
    rimGrad.addColorStop(0.22, 'rgba(255,255,255,0.18)');
    rimGrad.addColorStop(0.55, 'rgba(255,255,255,0.01)');
    rimGrad.addColorStop(1.00, 'rgba(255,255,255,0.07)');

    rc.fillStyle = rimGrad;
    rc.fillRect(0, 0, size, size);
    rc.globalCompositeOperation = 'destination-in';
    rc.drawImage(contentCanvas, 0, 0);

    outCtx.save();
    outCtx.globalCompositeOperation = 'screen';
    outCtx.drawImage(rimCanvas, 0, 0);
    outCtx.restore();
  }

  // ── 6. Gradient border ────────────────────────────────────────────────────
  drawBorderGradient(outCtx, contentCanvas, size, lightAngle);

  // ── 7. Inner shadow ───────────────────────────────────────────────────────
  {
    const innerCanvas = document.createElement('canvas');
    innerCanvas.width = innerCanvas.height = size;
    const ic = innerCanvas.getContext('2d')!;

    const innerGrad = ic.createRadialGradient(
      size / 2, size / 2, size * 0.18,
      size / 2, size / 2, size * 0.60,
    );
    innerGrad.addColorStop(0, 'rgba(0,0,0,0)');
    innerGrad.addColorStop(1, dark ? 'rgba(0,0,20,0.45)' : 'rgba(0,0,20,0.16)');
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

async function buildContentCanvas(layer: Layer, size: number): Promise<HTMLCanvasElement> {
  const { layout } = layer;
  const scale   = layout.scale / 100;
  const offsetX = (layout.x / 100) * size;
  const offsetY = (layout.y / 100) * size;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.save();
  ctx.translate(size / 2 + offsetX, size / 2 + offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-size / 2, -size / 2);

  if (layer.fill.type === 'solid') {
    ctx.fillStyle = layer.fill.color ?? '#ffffff';
    ctx.fillRect(0, 0, size, size);
  } else if (layer.fill.type === 'gradient' && 'stops' in layer.fill) {
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    layer.fill.stops.forEach((s) => grad.addColorStop(s.offset, s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  if (layer.blobUrl) {
    try {
      const img = await getCachedImage(layer.blobUrl);
      const iw  = img.naturalWidth;
      const ih  = img.naturalHeight;
      const sc  = Math.min(size / iw, size / ih);
      const w   = iw * sc;
      const h   = ih * sc;
      const x   = (size - w) / 2;
      const y   = (size - h) / 2;
      ctx.drawImage(img, x, y, w, h);
    } catch { /* ignore broken blobs */ }
  }

  ctx.restore();
  return canvas;
}

// ─── Render a single layer ────────────────────────────────────────────────────

async function renderLayerToCanvas(
  layer: Layer,
  size: number,
  mode: AppearanceMode,
  lightAngle: number,
  bgCanvas: HTMLCanvasElement,
): Promise<HTMLCanvasElement | null> {
  if (!layer.visible) return null;

  const contentCanvas = await buildContentCanvas(layer, size);
  const { liquidGlass } = layer;

  // ── Output canvas ─────────────────────────────────────────────────────────
  const out    = document.createElement('canvas');
  out.width    = out.height = size;
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
        mode === 'dark'       ? 1
        : (mode === 'tinted-light' || mode === 'tinted-dark' ||
           mode === 'clear-light'  || mode === 'clear-dark') ? 2
        : 0;

      const params: LiquidGlassParams = {
        blur:             liquidGlass.blur.enabled        ? liquidGlass.blur.value / 100        : 0.35,
        translucency:     liquidGlass.translucency.enabled ? liquidGlass.translucency.value / 100 : 0.55,
        specular:         liquidGlass.specular,
        specularIntensity: 1.0,
        lightAngle,
        opacity:          layer.opacity / 100,
        mode:             glMode,
        darkAdjust:       liquidGlass.dark.enabled  ? liquidGlass.dark.value / 100  : 0,
        monoAdjust:       liquidGlass.mono.enabled  ? liquidGlass.mono.value / 100  : 0,
        aberration:       0.65, // always-on chromatic aberration at moderate intensity
      };

      renderer.render(contentCanvas, bgCanvas, params);

      // ── Drop shadow (Canvas 2D, pre-glass) ────────────────────────────────
      drawDropShadow(outCtx, contentCanvas, size, liquidGlass.shadow);

      // ── WebGL glass result ────────────────────────────────────────────────
      outCtx.save();
      outCtx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);
      outCtx.drawImage(_glCanvas, 0, 0);
      outCtx.restore();

      // ── Border gradient on top of WebGL result ────────────────────────────
      drawBorderGradient(outCtx, contentCanvas, size, lightAngle);

      return out;
    } catch {
      // fall through to Canvas 2D
    }
  }

  // ── Canvas 2D fallback ────────────────────────────────────────────────────
  await renderLayerCanvas2D(
    outCtx, contentCanvas, size, mode, lightAngle, bgCanvas,
    liquidGlass, layer.opacity, layer.blendMode,
  );

  return out;
}

// ─── Mono/greyscale filter ────────────────────────────────────────────────────

function applyMonoFilter(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const id  = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d   = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(id, 0, 0);
}

// ─── Main compositor ──────────────────────────────────────────────────────────

export async function renderIconToCanvas(
  outputCanvas: HTMLCanvasElement,
  ctx: RenderContext,
): Promise<void> {
  const { layers, background, lightAngle, appearanceMode, size } = ctx;
  const c = outputCanvas.getContext('2d');
  if (!c) return;

  outputCanvas.width = outputCanvas.height = size;
  c.clearRect(0, 0, size, size);

  // Build base background canvas
  const bgCanvas = createBackgroundCanvas(background as any, size, size);
  const bgCtx    = bgCanvas.getContext('2d')!;

  // Apply mode-specific background overlay
  const modeOverlays: Partial<Record<AppearanceMode, () => void>> = {
    dark:         () => { bgCtx.fillStyle = 'rgba(0,0,0,0.55)';          bgCtx.fillRect(0, 0, size, size); },
    'tinted-light': () => {
      const hue = (background as any).hue ?? 220;
      bgCtx.fillStyle = `hsla(${hue},28%,82%,0.88)`;
      bgCtx.fillRect(0, 0, size, size);
    },
    'tinted-dark': () => {
      const hue = (background as any).hue ?? 220;
      bgCtx.fillStyle = `hsla(${hue},22%,16%,0.92)`;
      bgCtx.fillRect(0, 0, size, size);
    },
    'clear-light': () => { bgCtx.fillStyle = 'rgba(235,235,240,0.85)'; bgCtx.fillRect(0, 0, size, size); },
    'clear-dark':  () => { bgCtx.fillStyle = 'rgba(28,28,30,0.85)';    bgCtx.fillRect(0, 0, size, size); },
  };
  modeOverlays[appearanceMode]?.();

  // ── Squircle drop shadow (drawn before clip, will be covered by icon body) ──
  {
    c.save();
    c.shadowColor   = 'rgba(0,0,28,0.48)';
    c.shadowBlur    = size * 0.055;
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

  // Draw background
  c.drawImage(bgCanvas, 0, 0, size, size);

  // Sort and composite layers
  const rootLayers = [...layers]
    .filter((l) => l.visible && l.parentId === null)
    .sort((a, b) => a.order - b.order);

  for (const layer of rootLayers) {
    if (layer.type === 'group') {
      const children = [...layers]
        .filter((l) => l.parentId === layer.id && l.visible)
        .sort((a, b) => a.order - b.order);

      // Render all children into an intermediate canvas, then apply group opacity once
      const groupCanvas = document.createElement('canvas');
      groupCanvas.width = groupCanvas.height = size;
      const gc = groupCanvas.getContext('2d')!;

      for (const child of children) {
        const lc = await renderLayerToCanvas(child, size, appearanceMode, lightAngle, bgCanvas);
        if (lc) gc.drawImage(lc, 0, 0);
      }

      c.globalAlpha = layer.opacity / 100;
      c.drawImage(groupCanvas, 0, 0);
      c.globalAlpha = 1;
    } else {
      const lc = await renderLayerToCanvas(layer, size, appearanceMode, lightAngle, bgCanvas);
      if (lc) c.drawImage(lc, 0, 0);
    }
  }

  c.restore(); // end squircle clip

  // ── Squircle rim / border (drawn after clip is released) ──────────────────
  {
    const angleRad = (lightAngle * Math.PI) / 180;
    const lx = Math.cos(angleRad);
    const ly = -Math.sin(angleRad);

    c.save();
    drawSquirclePath(c, 0, 0, size);

    const rimGrad = c.createLinearGradient(
      size * (0.5 + lx * 0.5), size * (0.5 + ly * 0.5),
      size * (0.5 - lx * 0.5), size * (0.5 - ly * 0.5),
    );
    rimGrad.addColorStop(0.00, 'rgba(255,255,255,0.82)');
    rimGrad.addColorStop(0.28, 'rgba(255,255,255,0.42)');
    rimGrad.addColorStop(0.60, 'rgba(255,255,255,0.12)');
    rimGrad.addColorStop(1.00, 'rgba(255,255,255,0.05)');

    c.strokeStyle = rimGrad;
    c.lineWidth   = Math.max(1.5, size * 0.002);
    c.stroke();
    c.restore();
  }

  // Apply mono/greyscale filter for tinted and clear variants
  if (
    appearanceMode === 'tinted-light' ||
    appearanceMode === 'tinted-dark'  ||
    appearanceMode === 'clear-light'  ||
    appearanceMode === 'clear-dark'
  ) {
    applyMonoFilter(outputCanvas);
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
  await renderIconToCanvas(canvas, { layers, background, lightAngle, appearanceMode: mode, size });
  return canvas.toDataURL('image/png');
}
