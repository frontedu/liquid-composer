import React, { useRef, useEffect, useLayoutEffect, useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, $background, updateLayer, setHistoryGesture } from '../../store/iconStore';
import { $appearanceMode, $lightAngle, $zoom, $selectedLayerId, $hoveredLayerId, $webgl2Status, $webgl2Error, $webgl2Restores, $showGrid, $gridStyle, $mobilePane, selectLayer, inspectLayer, stepZoom, MOBILE_QUERY } from '../../store/uiStore';
import { renderIconToCanvas, exportIcon, exportZip, type ExportOptions } from '../../engine/IconRenderer';
import { drawSquirclePath } from '../../engine/ImageProcessor';
import { CHICLET_SHADOW } from '../../engine/glassContract';
import { $fileDropZone } from '../useFileDrop';
import { BottomBar } from '../layout/BottomBar';
import { GridFour, CircleHalf } from '@phosphor-icons/react';
import type { Layer } from '../../types/index';

const ICON_BASE_SIZE = 750; // px at 100% zoom
const MOBILE_ICON_MARGIN_X = 16; // px per side
const MOBILE_ICON_MARGIN_Y = 76; // px per side
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;

function IconShadow({ size }: { size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const u = size / 1024;
  const pad = Math.ceil((CHICLET_SHADOW.offsetY + 3 * CHICLET_SHADOW.radius) * u);
  const side = size + 2 * pad;

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, side, side);
    drawSquirclePath(ctx, pad - side, pad, size);
    ctx.shadowColor = `rgba(0,0,0,${CHICLET_SHADOW.opacity})`;
    ctx.shadowBlur = 2 * CHICLET_SHADOW.radius * u;
    ctx.shadowOffsetX = side;
    ctx.shadowOffsetY = CHICLET_SHADOW.offsetY * u;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.globalCompositeOperation = 'destination-out';
    drawSquirclePath(ctx, pad, pad, size);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }, [size, side, pad, u]);

  return (
    <canvas
      ref={canvasRef}
      width={side}
      height={side}
      className="absolute pointer-events-none"
      style={{ left: -pad, top: -pad, width: side, height: side }}
    />
  );
}

function GridOverlay({ size, dark }: { size: number; dark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const rgb = dark ? '0,0,0' : '255,255,255';
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 1;

    ctx.strokeStyle = `rgba(${rgb},0.20)`;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const p = (size * i) / 8;
      ctx.moveTo(p, 0); ctx.lineTo(p, size);
      ctx.moveTo(0, p); ctx.lineTo(size, p);
    }
    ctx.moveTo(0, 0); ctx.lineTo(size, size);
    ctx.moveTo(size, 0); ctx.lineTo(0, size);
    ctx.stroke();

    const c = size / 2;
    ctx.strokeStyle = `rgba(${rgb},0.35)`;
    ctx.beginPath();
    for (const r of [410, 256, 102]) {
      const radius = (size * r) / 1024;
      ctx.moveTo(c + radius, c);
      ctx.arc(c, c, radius, 0, Math.PI * 2);
    }
    ctx.stroke();
  }, [size, dark]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="absolute pointer-events-none z-10"
      style={{ width: size, height: size, top: 0, left: 0 }}
    />
  );
}

// ── Hit test ──
const HIT_SIZE = 64; // px
const hitImages = new Map<string, Promise<HTMLImageElement>>();
const hitMasks = new Map<string, Uint8ClampedArray>();
let hitCtx: CanvasRenderingContext2D | null = null;

function loadHitImage(url: string): Promise<HTMLImageElement> {
  let pending = hitImages.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    hitImages.set(url, pending);
    pending.catch(() => hitImages.delete(url));
    if (hitImages.size > 32) hitImages.delete(hitImages.keys().next().value!);
  }
  return pending;
}

async function getHitMask(url: string, layout: { x: number; y: number; scale: number }): Promise<Uint8ClampedArray> {
  const key = `${url}:${layout.x}:${layout.y}:${layout.scale}`;
  const cached = hitMasks.get(key);
  if (cached) return cached;
  const img = await loadHitImage(url);
  const sz = HIT_SIZE;
  if (!hitCtx) {
    const oc = document.createElement('canvas');
    oc.width = oc.height = sz;
    hitCtx = oc.getContext('2d', { willReadFrequently: true })!;
  }
  const ox = hitCtx;
  ox.setTransform(1, 0, 0, 1, 0, 0);
  ox.clearRect(0, 0, sz, sz);
  const scale = layout.scale / 100;
  const tx = layout.x / 100;
  const ty = layout.y / 100;
  ox.translate(sz / 2 + tx * sz, sz / 2 + ty * sz);
  ox.scale(scale, scale);
  ox.translate(-sz / 2, -sz / 2);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const sc = Math.min(sz / iw, sz / ih);
  ox.drawImage(img, (sz - iw * sc) / 2, (sz - ih * sc) / 2, iw * sc, ih * sc);
  const data = ox.getImageData(0, 0, sz, sz).data;
  hitMasks.set(key, data);
  if (hitMasks.size > 64) hitMasks.delete(hitMasks.keys().next().value!);
  return data;
}

export function IconCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layers = useStore($layers);
  const background = useStore($background);
  const mode = useStore($appearanceMode);
  const lightAngle = useStore($lightAngle);
  const zoom = useStore($zoom);
  const selectedLayerId = useStore($selectedLayerId);
  const hoveredLayerId = useStore($hoveredLayerId);
  const webgl2Status = useStore($webgl2Status);
  const webgl2Error = useStore($webgl2Error);
  const webgl2Restores = useStore($webgl2Restores);
  const showGrid = useStore($showGrid);
  const gridStyle = useStore($gridStyle);
  const pane = useStore($mobilePane);
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [fitSize, setFitSize] = useState<number | null>(null);
  const over = useStore($fileDropZone) === 'canvas';

  const dragState = useRef<{
    layerId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    rafId: number;
    pendingX: number;
    pendingY: number;
    moved?: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ layerId: string; time: number; x: number; y: number } | null>(null);
  const inspectRef = useRef<string | null>(null);

  const iconSize = fitSize ?? Math.round(ICON_BASE_SIZE * (zoom / 100));
  const dpr = typeof window !== 'undefined' ? Math.max(2, Math.min(window.devicePixelRatio || 1, 3)) : 2;
  const renderSize = Math.max(1024, Math.min(2048, Math.round((fitSize ?? ICON_BASE_SIZE) * dpr)));

  const workspaceRef  = useRef<HTMLDivElement>(null);
  const outlineImgRef = useRef<HTMLImageElement>(null);
  const renderingRef  = useRef(false);
  const pendingRef    = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const mobile = window.matchMedia(MOBILE_QUERY);
    const measure = () => {
      if (!mobile.matches) setFitSize(null);
      else if (el.clientWidth) setFitSize(Math.max(1, Math.min(el.clientWidth - 2 * MOBILE_ICON_MARGIN_X, el.clientHeight - 2 * MOBILE_ICON_MARGIN_Y)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (window.matchMedia(MOBILE_QUERY).matches && (fitSize === null || pane !== 'canvas'))) return;

    const params = { layers, background, lightAngle, appearanceMode: mode, size: renderSize };

    const run = () => {
      renderingRef.current = true;
      renderIconToCanvas(canvas, params).catch(console.error).then(() => {
        renderingRef.current = false;
        if (pendingRef.current) {
          const next = pendingRef.current;
          pendingRef.current = null;
          next();
        }
      });
    };

    if (renderingRef.current) {
      pendingRef.current = run;
    } else {
      pendingRef.current = null;
      run();
    }
  }, [layers, background, lightAngle, mode, renderSize, webgl2Restores, fitSize, pane]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const handler = async (e: Event) => {
      const options = (e as CustomEvent<ExportOptions | null>).detail ?? { format: 'png', size: 1024 };
      if (options.clipboard) {
        const png = exportIcon(layers, background, lightAngle, mode, { ...options, format: 'png' });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).catch(console.error);
        return;
      }
      const blob = await (options.allModes
        ? exportZip(layers, background, lightAngle)
        : exportIcon(layers, background, lightAngle, mode, options)
      ).catch((err: unknown) => { console.error(err); return null; });
      if (!blob) return;
      const ext = blob.type.replace('image/', '').replace('jpeg', 'jpg');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = options.allModes ? 'icon.zip' : `icon-${options.size}.${ext}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    window.addEventListener('icon-export', handler);
    return () => window.removeEventListener('icon-export', handler);
  }, [layers, background, lightAngle, mode]);

  const hitTestLayer = useCallback(async (layer: { blobUrl?: string; layout: { x: number; y: number; scale: number } }, nx: number, ny: number): Promise<boolean> => {
    if (!layer.blobUrl) return false;
    try {
      const data = await getHitMask(layer.blobUrl, layer.layout);
      const px = Math.max(0, Math.min(HIT_SIZE - 1, Math.round(nx * HIT_SIZE)));
      const py = Math.max(0, Math.min(HIT_SIZE - 1, Math.round(ny * HIT_SIZE)));
      return data[(py * HIT_SIZE + px) * 4 + 3] > 10;
    } catch { return false; }
  }, []);

  const handleCanvasPointerDown = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    inspectRef.current = null;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const nx = (e.clientX - rect.left) / iconSize;
    const ny = (e.clientY - rect.top) / iconSize;
    const target = e.currentTarget as HTMLDivElement;

    const alreadySelected = selectedLayerId
      ? layers.find(l => l.id === selectedLayerId && l.visible && l.type !== 'group' && l.blobUrl)
      : null;

    if (alreadySelected) {
      dragState.current = {
        layerId: alreadySelected.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: alreadySelected.layout.x,
        origY: alreadySelected.layout.y,
        rafId: 0,
        pendingX: alreadySelected.layout.x,
        pendingY: alreadySelected.layout.y,
      };
      target.setPointerCapture(e.pointerId);

      // Verify hit async; if miss, cancel drag and do full hit test
      const hit = await hitTestLayer(alreadySelected, nx, ny);
      if (hit) return; // drag already armed, all good

      // Miss — cancel drag and fall through to full search below
      dragState.current = null;
    }

    // Slow path: async hit test all visible layers
    const visibleLayers = [...layers].filter((l) => l.visible && l.type !== 'group' && l.blobUrl)
      .sort((a, b) => b.order - a.order);

    let hitId: string | null = null;
    for (const l of visibleLayers) {
      const hit = await hitTestLayer(l, nx, ny);
      if (hit) { hitId = l.id; break; }
    }

    if (hitId) {
      selectLayer(hitId);
      const layer = layers.find((l) => l.id === hitId)!;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        lastTapRef.current = { layerId: hitId, time: e.timeStamp, x: e.clientX, y: e.clientY };
        return;
      }
      dragState.current = {
        layerId: hitId,
        startX: e.clientX,
        startY: e.clientY,
        origX: layer.layout.x,
        origY: layer.layout.y,
        rafId: 0,
        pendingX: layer.layout.x,
        pendingY: layer.layout.y,
      };
    } else {
      selectLayer(null);
    }
  }, [layers, iconSize, hitTestLayer, selectedLayerId]);

  const hoverRafRef = useRef(0);
  const iconAreaRef = useRef<HTMLDivElement>(null);
  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current && !(e.buttons & 1)) {
      dragState.current = null;
      setSnapGuide({ x: false, y: false });
      setHistoryGesture(false);
    }
    if (!dragState.current) {
      if (hoverRafRef.current) return; // already pending
      const clientX = e.clientX;
      const clientY = e.clientY;
      hoverRafRef.current = requestAnimationFrame(async () => {
        hoverRafRef.current = 0;
        const el = iconAreaRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const nx = (clientX - rect.left) / iconSize;
        const ny = (clientY - rect.top) / iconSize;
        const visibleLayers = [...layers]
          .filter((l) => l.visible && l.type !== 'group' && l.blobUrl)
          .sort((a, b) => b.order - a.order);
        let hitId: string | null = null;
        for (const l of visibleLayers) {
          const hit = await hitTestLayer(l, nx, ny);
          if (hit) { hitId = l.id; break; }
        }
        $hoveredLayerId.set(hitId);
      });
      return;
    }
    const ds = dragState.current;
    if (!ds.moved) {
      if (Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY) < 3) return; // px
      ds.moved = true;
    }
    // Convert pixel delta → layout units (percent of icon size)
    const SNAP_THRESHOLD = 8; // px
    let dx = ((e.clientX - ds.startX) / iconSize) * 100;
    let dy = ((e.clientY - ds.startY) / iconSize) * 100;
    const lockX = e.shiftKey && Math.abs(dy) > Math.abs(dx);
    const lockY = e.shiftKey && !lockX;
    if (lockX) dx = 0;
    if (lockY) dy = 0;
    let newX = ds.origX + dx;
    let newY = ds.origY + dy;

    const snapX = Math.abs(newX) < SNAP_THRESHOLD / iconSize * 100;
    const snapY = Math.abs(newY) < SNAP_THRESHOLD / iconSize * 100;
    if (snapX) newX = 0;
    if (snapY) newY = 0;

    setSnapGuide((prev) => (prev.x === snapX && prev.y === snapY ? prev : { x: snapX, y: snapY }));
    ds.pendingX = newX;
    ds.pendingY = newY;

    if (outlineImgRef.current) {
      const layer = layers.find(l => l.id === ds.layerId);
      const scale = layer?.layout.scale ?? 100;
      outlineImgRef.current.style.transform =
        `translate(${(newX / 100) * iconSize}px, ${(newY / 100) * iconSize}px) scale(${scale / 100})`;
    }

    if (!ds.rafId) {
      ds.rafId = requestAnimationFrame(() => {
        ds.rafId = 0;
        if (!dragState.current) return;
        const dragged = layers.find((l) => l.id === dragState.current!.layerId);
        if (!dragged) return;
        updateLayer(dragged.id, { layout: { ...dragged.layout, x: dragState.current.pendingX, y: dragState.current.pendingY } });
        setHistoryGesture(true);
      });
    }
  }, [layers, iconSize]);

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    const last = lastTapRef.current;
    const tap = e.type === 'pointerup' && ds && !ds.moved ? { layerId: ds.layerId, time: e.timeStamp, x: e.clientX, y: e.clientY } : null;
    const doubleTap = tap && last && last.layerId === tap.layerId && tap.time - last.time < DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) < DOUBLE_TAP_PX;
    lastTapRef.current = doubleTap ? null : tap;
    inspectRef.current = tap && doubleTap ? tap.layerId : null;
    dragState.current = null;
    setSnapGuide({ x: false, y: false });
    setHistoryGesture(false);
  }, []);

  const bgStyle = { background: '#171719' };

  return (
    <div
      ref={workspaceRef}
      className="icon-workspace flex-1 min-w-0 flex items-center justify-center relative overflow-hidden"
      data-file-drop="canvas"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('[data-icon-area]')) {
          (document.activeElement as HTMLElement | null)?.blur();
          selectLayer(null);
        }
      }}
    >
      <div className="absolute inset-0 transition-colors duration-500" style={bgStyle} />
      {webgl2Status === 'error' && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-[8px] text-[11px] text-[#ebebf5]"
          style={{ background: 'rgba(255,69,58,0.18)', border: '0.5px solid rgba(255,69,58,0.45)' }}
        >
          WebGL2 unavailable: {webgl2Error || 'unknown error'}. Liquid Glass renders without refraction.
        </div>
      )}


      {over && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-[#0a84ff]/20 border-4 border-[#0a84ff] border-dashed">
          <div className="text-white font-medium text-lg">Drop image to add layer</div>
        </div>
      )}

      {snapGuide.x && (
        <div className="absolute pointer-events-none z-30" style={{ left: '50%', top: 0, width: 1, height: '100%', background: 'rgba(255,59,48,0.7)', transform: 'translateX(-0.5px)' }} />
      )}
      {snapGuide.y && (
        <div className="absolute pointer-events-none z-30" style={{ top: '50%', left: 0, height: 1, width: '100%', background: 'rgba(255,59,48,0.7)', transform: 'translateY(-0.5px)' }} />
      )}

      <div
        ref={iconAreaRef}
        data-icon-area
        className="relative"
        style={{ width: iconSize, height: iconSize }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onClick={() => {
          if (inspectRef.current) inspectLayer(inspectRef.current);
          inspectRef.current = null;
        }}
        onPointerLeave={() => { if (!dragState.current) $hoveredLayerId.set(null); }}
      >
        <IconShadow size={iconSize} />
        <canvas
          ref={canvasRef}
          width={renderSize}
          height={renderSize}
          style={{
            width: iconSize,
            height: iconSize,
            position: 'relative',
            zIndex: 1,
            borderRadius: '26%',
          }}
          className="block"
        />
        {showGrid && <GridOverlay size={iconSize} dark={gridStyle === 'dark'} />}

        {(() => {
          const outlineId = hoveredLayerId ?? selectedLayerId;
          const outlineLayer = outlineId ? layers.find((l) => l.id === outlineId) : null;
          if (!outlineLayer?.blobUrl) return null;
          const isHover = outlineId === hoveredLayerId && outlineId !== selectedLayerId;
          const k = 100 / outlineLayer.layout.scale;
          const gap = Math.max(1, iconSize * 4 / 1024) * k; // 4 pt of the 1024 pt canvas
          const band = (isHover ? 3 : 6) * k; // screen px
          return (
            <>
              <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
                <defs>
                  <filter id="layer-outline" x="-10%" y="-10%" width="120%" height="120%">
                    <feMorphology operator="dilate" radius={gap - k} in="SourceAlpha" result="haloIn" />
                    <feMorphology operator="dilate" radius={gap} in="SourceAlpha" result="inner" />
                    <feMorphology operator="dilate" radius={gap + band} in="SourceAlpha" result="outer" />
                    <feMorphology operator="dilate" radius={gap + band + k} in="SourceAlpha" result="haloOut" />
                    <feComposite in="outer" in2="inner" operator="out" result="ring" />
                    <feComposite in="haloOut" in2="haloIn" operator="out" result="halo" />
                    <feComposite in="halo" in2="ring" operator="out" result="edge" />
                    <feFlood floodColor="#000000" floodOpacity="0.3" />
                    <feComposite in2="edge" operator="in" result="edgeColor" />
                    <feFlood floodColor="#0a84ff" floodOpacity={isHover ? 0.667 : 1} />
                    <feComposite in2="ring" operator="in" />
                    <feMerge>
                      <feMergeNode in="edgeColor" />
                      <feMergeNode />
                    </feMerge>
                  </filter>
                </defs>
              </svg>
              <img
                ref={outlineImgRef}
                src={outlineLayer.blobUrl}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: iconSize,
                  height: iconSize,
                  objectFit: 'contain',
                  filter: 'url(#layer-outline)',
                  pointerEvents: 'none',
                  zIndex: 2,
                  opacity: outlineLayer.opacity / 100,
                  transform: `translate(${(outlineLayer.layout.x / 100) * iconSize}px, ${(outlineLayer.layout.y / 100) * iconSize}px) scale(${outlineLayer.layout.scale / 100})`,
                }}
              />
            </>
          );
        })()}
      </div>

      <div className="canvas-controls" onPointerDown={(e) => e.stopPropagation()}>
        <BottomBar />
        <div className="appearance-segments canvas-grid-toggle" role="group" aria-label="Icon grid">
          <button
            type="button"
            aria-pressed={showGrid}
            onClick={() => $showGrid.set(!showGrid)}
            title="Toggle icon grid"
          >
            <GridFour size={12} />
            Grid
          </button>
          {showGrid && (
            <>
              <span className="segment-divider" aria-hidden="true" />
              <button
                type="button"
                onClick={() => $gridStyle.set(gridStyle === 'light' ? 'dark' : 'light')}
                title="Grid style"
                aria-label={`Grid style: ${gridStyle}`}
              >
                <CircleHalf size={12} />
                {gridStyle === 'light' ? 'Light' : 'Dark'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
