export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function loadImageToCanvas(
  url: string,
  width: number,
  height: number
): Promise<HTMLCanvasElement> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.drawImage(img, x, y, w, h);
  return canvas;
}

export function drawSquirclePath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, n = 5) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;

  ctx.beginPath();
  for (let i = 0; i <= 360; i++) {
    const angle = (i * 2 * Math.PI) / 360;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = cx + r * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n);
    const py = cy + r * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function drawSquirclePathToPath2D(size: number, n = 5): Path2D {
  const path = new Path2D();
  const r = size / 2;

  for (let i = 0; i <= 360; i++) {
    const angle = (i * 2 * Math.PI) / 360;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = r + r * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n);
    const py = r + r * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n);
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

export function createBackgroundCanvas(
  config: { type: string; colors?: [string, string]; color?: string; angle?: number },
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  if (config.type === 'gradient' && config.colors) {
    const angle = ((config.angle ?? 135) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = Math.sqrt(width * width + height * height) / 2;
    const cx = width / 2;
    const cy = height / 2;
    const grad = ctx.createLinearGradient(
      cx - cos * r, cy - sin * r,
      cx + cos * r, cy + sin * r
    );
    grad.addColorStop(0, config.colors[0]);
    grad.addColorStop(1, config.colors[1]);
    ctx.fillStyle = grad;
  } else if (config.type === 'solid' && config.color) {
    ctx.fillStyle = config.color;
  } else {
    ctx.fillStyle = '#667eea';
  }

  ctx.fillRect(0, 0, width, height);
  return canvas;
}
