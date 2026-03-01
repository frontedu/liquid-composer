import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, $background, addLayer, updateLayer } from '../../store/iconStore';
import { $appearanceMode, $lightAngle, $zoom, $selectedLayerId, $hoveredLayerId, selectLayer, stepZoom } from '../../store/uiStore';
import { renderIconToCanvas, exportIconPNG } from '../../engine/IconRenderer';
import { drawSquirclePath } from '../../engine/ImageProcessor';
import { BottomBar } from '../layout/BottomBar';

const ICON_BASE_SIZE = 750; // px at 100% zoom

function useDragDrop() {
  const [over, setOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'image/svg+xml' || f.type === 'image/png' || f.type === 'image/jpeg'
    );
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      addLayer(url, file.name);
    });
  }, []);

  return { over, handleDragOver, handleDragLeave, handleDrop };
}

// Shadow drawn behind the icon squircle
function IconShadow({ size, mode }: { size: number; mode: string }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        width: size,
        height: size,
        top: 0,
        left: 0,
        filter: `drop-shadow(0 ${size * 0.04}px ${size * 0.1}px rgba(0,0,0,${mode === 'dark' ? 0.7 : 0.35}))`,
        transform: 'translateZ(0)',
      }}
    >
      <canvas
        width={size}
        height={size}
        ref={(ref) => {
          if (!ref) return;
          const ctx = ref.getContext('2d')!;
          ctx.clearRect(0, 0, size, size);
          drawSquirclePath(ctx, 0, 0, size);
          ctx.fillStyle = 'rgba(0,0,0,0.01)';
          ctx.fill();
        }}
        style={{ width: size, height: size }}
      />
    </div>
  );
}

// Apple-style safe area overlay with guides
function SafeAreaOverlay({ size }: { size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);

    const color = 'rgba(255,255,255,0.35)';
    const thinColor = 'rgba(255,255,255,0.20)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    // Outer squircle boundary (full icon shape)
    ctx.save();
    ctx.strokeStyle = thinColor;
    drawSquirclePath(ctx, 0, 0, size);
    ctx.stroke();
    ctx.restore();

    // Inner safe area squircle (70% of canvas)
    const safe = size * 0.7;
    const safeOffset = (size - safe) / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 4]);
    drawSquirclePath(ctx, safeOffset, safeOffset, safe);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Center crosshair
    const cx = size / 2;
    const cy = size / 2;
    const crossLen = size * 0.06;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - crossLen, cy);
    ctx.lineTo(cx + crossLen, cy);
    ctx.moveTo(cx, cy - crossLen);
    ctx.lineTo(cx, cy + crossLen);
    ctx.stroke();
    ctx.restore();

    // Diagonal corner guides (from each corner toward center)
    const diagLen = size * 0.08;
    ctx.save();
    ctx.strokeStyle = thinColor;
    ctx.lineWidth = 1;
    const corners = [
      [0, 0, 1, 1],
      [size, 0, -1, 1],
      [0, size, 1, -1],
      [size, size, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * size * 0.04, y + dy * size * 0.04);
      ctx.lineTo(x + dx * (size * 0.04 + diagLen), y + dy * (size * 0.04 + diagLen));
      ctx.stroke();
    }
    ctx.restore();

    // Corner tick marks at safe area corners
    const tickLen = size * 0.025;
    const safeLeft = safeOffset;
    const safeTop = safeOffset;
    const safeRight = safeOffset + safe;
    const safeBottom = safeOffset + safe;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(safeLeft, safeTop + tickLen); ctx.lineTo(safeLeft, safeTop); ctx.lineTo(safeLeft + tickLen, safeTop);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(safeRight - tickLen, safeTop); ctx.lineTo(safeRight, safeTop); ctx.lineTo(safeRight, safeTop + tickLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(safeLeft, safeBottom - tickLen); ctx.lineTo(safeLeft, safeBottom); ctx.lineTo(safeLeft + tickLen, safeBottom);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(safeRight - tickLen, safeBottom); ctx.lineTo(safeRight, safeBottom); ctx.lineTo(safeRight, safeBottom - tickLen);
    ctx.stroke();
    ctx.restore();
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="absolute pointer-events-none z-10"
      style={{ width: size, height: size, top: 0, left: 0 }}
      title="Safe area: keep essential shapes within this boundary (Apple HIG)"
    />
  );
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
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const { over, handleDragOver, handleDragLeave, handleDrop } = useDragDrop();

  // On-canvas drag state
  const dragState = useRef<{
    layerId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    rafId: number;
    pendingX: number;
    pendingY: number;
  } | null>(null);

  const iconSize = Math.round(ICON_BASE_SIZE * (zoom / 100));
  // Render size is fixed relative to ICON_BASE_SIZE × DPR — never scales with zoom.
  // Zoom is purely CSS (the canvas is scaled via width/height style). This keeps
  // render cost constant at all zoom levels.
  const dpr = typeof window !== 'undefined' ? Math.max(2, Math.min(window.devicePixelRatio || 1, 3)) : 2;
  const renderSize = Math.max(1024, Math.min(2048, Math.round(ICON_BASE_SIZE * dpr)));

  const outlineImgRef = useRef<HTMLImageElement>(null);
  const renderingRef  = useRef(false);
  const pendingRef    = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const params = { layers, background, lightAngle, appearanceMode: mode, size: renderSize };

    const run = () => {
      renderingRef.current = true;
      renderIconToCanvas(canvas, params).then(() => {
        renderingRef.current = false;
        // If a newer render was queued while we were busy, run it now
        if (pendingRef.current) {
          const next = pendingRef.current;
          pendingRef.current = null;
          next();
        }
      });
    };

    if (renderingRef.current) {
      // Already rendering — store only the latest request, drop intermediate ones
      pendingRef.current = run;
    } else {
      pendingRef.current = null;
      run();
    }
  }, [layers, background, lightAngle, mode, renderSize]);

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
    const handler = async () => {
      const dataUrl = await exportIconPNG(layers, background, lightAngle, mode, 1024);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'icon-1024.png';
      a.click();
    };
    window.addEventListener('icon-export', handler);
    return () => window.removeEventListener('icon-export', handler);
  }, [layers, background, lightAngle, mode]);

  // Hit-test a point against a layer's blobUrl by sampling alpha on a tiny offscreen canvas
  const hitTestLayer = useCallback(async (layer: { blobUrl?: string; layout: { x: number; y: number; scale: number } }, nx: number, ny: number): Promise<boolean> => {
    if (!layer.blobUrl) return false;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const sz = 64;
          const oc = document.createElement('canvas');
          oc.width = oc.height = sz;
          const ox = oc.getContext('2d')!;
          const scale = layer.layout.scale / 100;
          const tx = layer.layout.x / 100;
          const ty = layer.layout.y / 100;
          ox.translate(sz / 2 + tx * sz, sz / 2 + ty * sz);
          ox.scale(scale, scale);
          ox.translate(-sz / 2, -sz / 2);
          const iw = img.naturalWidth, ih = img.naturalHeight;
          const sc = Math.min(sz / iw, sz / ih);
          ox.drawImage(img, (sz - iw * sc) / 2, (sz - ih * sc) / 2, iw * sc, ih * sc);
          const px = Math.round(nx * sz);
          const py = Math.round(ny * sz);
          const data = ox.getImageData(Math.max(0, Math.min(sz - 1, px)), Math.max(0, Math.min(sz - 1, py)), 1, 1).data;
          resolve(data[3] > 10);
        } catch { resolve(false); }
      };
      img.onerror = () => resolve(false);
      img.src = layer.blobUrl!;
    });
  }, []);

  const handleCanvasPointerDown = useCallback(async (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const nx = (e.clientX - rect.left) / iconSize;
    const ny = (e.clientY - rect.top) / iconSize;
    const target = e.currentTarget as HTMLDivElement;

    // Fast path: if already selected layer is under cursor, arm drag immediately (sync)
    const alreadySelected = selectedLayerId
      ? layers.find(l => l.id === selectedLayerId && l.visible && l.type !== 'group' && l.blobUrl)
      : null;

    if (alreadySelected) {
      // Quick optimistic arm — verify alpha async but don't block drag start
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
      target.setPointerCapture(e.pointerId);
    } else {
      // Clicked empty space — clear selection
      selectLayer(null);
    }
  }, [layers, iconSize, hitTestLayer, selectedLayerId]);

  // Throttled canvas hover detection
  const hoverRafRef = useRef(0);
  const iconAreaRef = useRef<HTMLDivElement>(null);
  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Canvas hover: when not dragging, hit-test layers and update hoveredLayerId
    if (!dragState.current) {
      if (hoverRafRef.current) return; // already pending
      // Capture coordinates synchronously before React recycles the event
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
    // Convert pixel delta → layout units (percent of icon size)
    const SNAP_THRESHOLD = 8; // px
    let dx = ((e.clientX - ds.startX) / iconSize) * 100;
    let dy = ((e.clientY - ds.startY) / iconSize) * 100;
    let newX = ds.origX + dx;
    let newY = ds.origY + dy;

    const snapX = Math.abs(newX) < SNAP_THRESHOLD / iconSize * 100;
    const snapY = Math.abs(newY) < SNAP_THRESHOLD / iconSize * 100;
    if (snapX) newX = 0;
    if (snapY) newY = 0;

    setSnapGuide({ x: snapX, y: snapY });
    ds.pendingX = newX;
    ds.pendingY = newY;

    // Real-time outline position — direct DOM update, no React reconciliation
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
        updateLayer(dragState.current.layerId, {
          layout: { ...layers.find((l) => l.id === dragState.current!.layerId)!.layout, x: dragState.current.pendingX, y: dragState.current.pendingY },
        });
      });
    }
  }, [layers, iconSize]);

  const handleCanvasPointerUp = useCallback(() => {
    dragState.current = null;
    setSnapGuide({ x: false, y: false });
  }, []);

  const bgStyle = (() => {
    if (mode === 'dark') {
      return { background: '#0a0a0f' };
    }
    if (mode === 'clear') {
      // Dark checkered pattern (same as layer thumbnails) signals transparency
      return {
        backgroundColor: '#1e1e1e',
        backgroundImage: [
          'linear-gradient(45deg,#2e2e2e 25%,transparent 25%)',
          'linear-gradient(-45deg,#2e2e2e 25%,transparent 25%)',
          'linear-gradient(45deg,transparent 75%,#2e2e2e 75%)',
          'linear-gradient(-45deg,transparent 75%,#2e2e2e 75%)',
        ].join(','),
        backgroundSize: '18px 18px',
        backgroundPosition: '0 0,0 9px,9px -9px,-9px 0px',
      };
    }
    if (background.bgType === 'custom') {
      return { background: '#2a2a2e' };
    }
    if (background.type === 'gradient' && background.colors) {
      const toAlpha = (c: string) =>
        c.startsWith('hsl(')
          ? c.replace('hsl(', 'hsla(').replace(')', ', 0.2)')
          : `${c}33`;
      return {
        background: `linear-gradient(${background.angle ?? 90}deg, ${toAlpha(background.colors[0])}, ${toAlpha(background.colors[1])})`,
      };
    }
    return { background: '#2a2a2e' };
  })();

  return (
    <div
      className="flex-1 flex items-center justify-center relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPointerDown={(e) => {
        // Deselect when clicking outside the icon area (clicks on the icon div are handled separately)
        if (e.target === e.currentTarget || !(e.target as HTMLElement).closest('[data-icon-area]')) {
          selectLayer(null);
        }
      }}
    >
      <div className="absolute inset-0 transition-colors duration-500" style={bgStyle} />

      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {over && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a84ff]/20 border-4 border-[#0a84ff] border-dashed">
          <div className="text-white font-medium text-lg">Drop image to add layer</div>
        </div>
      )}

      {/* Snap guides */}
      {snapGuide.x && (
        <div className="absolute pointer-events-none z-30" style={{ left: '50%', top: 0, width: 1, height: '100%', background: 'rgba(255,59,48,0.7)', transform: 'translateX(-0.5px)' }} />
      )}
      {snapGuide.y && (
        <div className="absolute pointer-events-none z-30" style={{ top: '50%', left: 0, height: 1, width: '100%', background: 'rgba(255,59,48,0.7)', transform: 'translateY(-0.5px)' }} />
      )}

      {/* Outer container sized to iconSize; canvas always renders at ICON_BASE_SIZE
          and is scaled via CSS so borders/effects stay proportional at all zoom levels. */}
      <div
        ref={iconAreaRef}
        data-icon-area
        className="relative"
        style={{ width: iconSize, height: iconSize }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={() => { if (!dragState.current) $hoveredLayerId.set(null); }}
      >
        <IconShadow size={iconSize} mode={mode} />
        <canvas
          ref={canvasRef}
          width={renderSize}
          height={renderSize}
          style={{
            width: iconSize,
            height: iconSize,
            position: 'relative',
            zIndex: 1,
            borderRadius: '22.5%',
          }}
          className="block"
        />
        {showSafeArea && <SafeAreaOverlay size={iconSize} />}

        {/* Selection/hover outline — SVG filter dilates alpha to create a blue ring */}
        {(() => {
          const outlineId = hoveredLayerId ?? selectedLayerId;
          const outlineLayer = outlineId ? layers.find((l) => l.id === outlineId) : null;
          if (!outlineLayer?.blobUrl) return null;
          const isHover = outlineId === hoveredLayerId && outlineId !== selectedLayerId;
          return (
            <>
              <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
                <defs>
                  <filter id="layer-outline-selected" x="-10%" y="-10%" width="120%" height="120%">
                    {/* Dilate alpha outward to form outer ring boundary */}
                    <feMorphology operator="dilate" radius="7" in="SourceAlpha" result="outer" />
                    {/* Inner boundary — gap between outline and shape */}
                    <feMorphology operator="dilate" radius="2" in="SourceAlpha" result="inner" />
                    {/* Subtract inner from outer → thin ring */}
                    <feComposite in="outer" in2="inner" operator="out" result="ring" />
                    {/* Color the ring blue */}
                    <feFlood floodColor="#0a84ff" floodOpacity="1" result="color" />
                    <feComposite in="color" in2="ring" operator="in" />
                  </filter>
                  <filter id="layer-outline-hover" x="-10%" y="-10%" width="120%" height="120%">
                    <feMorphology operator="dilate" radius="7" in="SourceAlpha" result="outer" />
                    <feMorphology operator="dilate" radius="2" in="SourceAlpha" result="inner" />
                    <feComposite in="outer" in2="inner" operator="out" result="ring" />
                    <feFlood floodColor="#ffffff" floodOpacity="0.5" result="color" />
                    <feComposite in="color" in2="ring" operator="in" />
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
                  filter: `url(#${isHover ? 'layer-outline-hover' : 'layer-outline-selected'})`,
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

      <BottomBar />

      {/* Toolbar strip at bottom */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/30 backdrop-blur-sm rounded-full px-3 py-1">
        <button
          onClick={() => setShowSafeArea((s) => !s)}
          title="Toggle safe area guide (Apple HIG 70%)"
          className={`text-xs flex items-center gap-1 transition-colors ${showSafeArea ? 'text-[#0a84ff]' : 'text-white/50 hover:text-white/80'}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
            />
          </svg>
          Safe area
        </button>
        <div className="w-px h-3 bg-white/20" />
        <span className="text-xs text-white/50">{zoom}%</span>
      </div>
    </div>
  );
}
