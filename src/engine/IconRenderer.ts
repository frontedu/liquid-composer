import type { RenderContext, Layer, BackgroundConfig, AppearanceMode } from '../types/index';
import { drawSquirclePath, createBackgroundCanvas } from './ImageProcessor';

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

function blendModeToCanvas(mode: string): GlobalCompositeOperation {
  const map: Record<string, GlobalCompositeOperation> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    difference: 'difference',
    exclusion: 'exclusion',
    hue: 'hue',
    saturation: 'saturation',
    color: 'color',
    luminosity: 'luminosity',
  };
  return map[mode] ?? 'source-over';
}

async function renderLayerToCanvas(
  layer: Layer,
  size: number,
  mode: AppearanceMode,
  lightAngle: number
): Promise<HTMLCanvasElement | null> {
  if (!layer.visible) return null;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const { layout, liquidGlass } = layer;
  const scale = layout.scale / 100;
  const offsetX = (layout.x / 100) * size;
  const offsetY = (layout.y / 100) * size;

  ctx.save();
  ctx.globalAlpha = layer.opacity / 100;
  ctx.globalCompositeOperation = blendModeToCanvas(layer.blendMode);

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
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const imgScale = Math.min(size / iw, size / ih);
      const w = iw * imgScale;
      const h = ih * imgScale;
      const x = (size - w) / 2;
      const y = (size - h) / 2;
      ctx.drawImage(img, x, y, w, h);
    } catch {
      // ignore broken blob URLs
    }
  }

  if (liquidGlass.enabled) {
    if (liquidGlass.specular) {
      const angleRad = (lightAngle * Math.PI) / 180;
      const lx = Math.cos(angleRad);
      const ly = Math.sin(angleRad);

      const specGrad = ctx.createRadialGradient(
        size * (0.5 + lx * 0.3), size * (0.5 - ly * 0.3), 0,
        size * (0.5 + lx * 0.3), size * (0.5 - ly * 0.3), size * 0.6
      );
      specGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
      specGrad.addColorStop(0.4, 'rgba(255,255,255,0.08)');
      specGrad.addColorStop(1, 'rgba(255,255,255,0.0)');

      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = specGrad;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (liquidGlass.translucency.enabled) {
      const alpha = (liquidGlass.translucency.value / 100) * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (mode === 'dark' && liquidGlass.dark.enabled) {
      const alpha = (liquidGlass.dark.value / 100) * 0.6;
      ctx.fillStyle = `rgba(0,0,20,${alpha})`;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  ctx.restore();
  return canvas;
}

function applyMonoFilter(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export async function renderIconToCanvas(
  outputCanvas: HTMLCanvasElement,
  ctx: RenderContext
): Promise<void> {
  const { layers, background, lightAngle, appearanceMode, size } = ctx;
  const c = outputCanvas.getContext('2d');
  if (!c) return;

  outputCanvas.width = size;
  outputCanvas.height = size;
  c.clearRect(0, 0, size, size);

  c.save();
  drawSquirclePath(c, 0, 0, size);
  c.clip();

  const bgCanvas = createBackgroundCanvas(background as any, size, size);

  if (appearanceMode === 'dark') {
    const bgCtx = bgCanvas.getContext('2d')!;
    bgCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    bgCtx.fillRect(0, 0, size, size);
  } else if (appearanceMode === 'mono') {
    const bgCtx = bgCanvas.getContext('2d')!;
    bgCtx.fillStyle = 'rgba(128,128,128,1)';
    bgCtx.globalCompositeOperation = 'saturation';
    bgCtx.fillRect(0, 0, size, size);
  }

  c.drawImage(bgCanvas, 0, 0, size, size);

  const sortedLayers = [...layers]
    .filter((l) => l.visible && l.parentId === null)
    .sort((a, b) => a.order - b.order);

  for (const layer of sortedLayers) {
    if (layer.type === 'group') {
      const children = [...layers]
        .filter((l) => l.parentId === layer.id && l.visible)
        .sort((a, b) => a.order - b.order);
      for (const child of children) {
        const lCanvas = await renderLayerToCanvas(child, size, appearanceMode, lightAngle);
        if (lCanvas) {
          c.globalAlpha = layer.opacity / 100;
          c.drawImage(lCanvas, 0, 0);
          c.globalAlpha = 1;
        }
      }
    } else {
      const lCanvas = await renderLayerToCanvas(layer, size, appearanceMode, lightAngle);
      if (lCanvas) c.drawImage(lCanvas, 0, 0);
    }
  }

  c.restore();

  if (appearanceMode === 'mono') {
    applyMonoFilter(outputCanvas);
  }
}

export async function exportIconPNG(
  layers: Parameters<typeof renderIconToCanvas>[1]['layers'],
  background: Parameters<typeof renderIconToCanvas>[1]['background'],
  lightAngle: number,
  mode: AppearanceMode,
  size = 1024
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  await renderIconToCanvas(canvas, { layers, background, lightAngle, appearanceMode: mode, size });
  return canvas.toDataURL('image/png');
}
