import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, $background, addLayer } from '../../store/iconStore';
import { $appearanceMode, $lightAngle, $zoom, stepZoom } from '../../store/uiStore';
import { renderIconToCanvas, exportIconPNG } from '../../engine/IconRenderer';
import { drawSquirclePath } from '../../engine/ImageProcessor';
import { BottomBar } from '../layout/BottomBar';

const ICON_BASE_SIZE = 500; // px at 100% zoom

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

// 70% safe area overlay (per Apple HIG)
function SafeAreaOverlay({ size }: { size: number }) {
  const safe = size * 0.7;
  const offset = (size - safe) / 2;
  return (
    <div
      className="absolute pointer-events-none z-10 border border-dashed border-white/30 rounded-sm"
      style={{
        width: safe,
        height: safe,
        top: offset,
        left: offset,
      }}
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
  const [showSafeArea, setShowSafeArea] = useState(false);
  const { over, handleDragOver, handleDragLeave, handleDrop } = useDragDrop();

  const iconSize = Math.round(ICON_BASE_SIZE * (zoom / 100));
  // Render at physical pixel resolution for crisp display on retina screens (2× DPR)
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const renderSize = iconSize * dpr;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    renderIconToCanvas(canvas, {
      layers,
      background,
      lightAngle,
      appearanceMode: mode,
      size: renderSize,
    }).then(() => {
      if (cancelled) return;
    });

    return () => { cancelled = true; };
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
    if (background.type === 'gradient' && background.colors) {
      const toAlpha = (c: string) =>
        c.startsWith('hsl(')
          ? c.replace('hsl(', 'hsla(').replace(')', ', 0.2)')
          : `${c}33`;
      return {
        background: `linear-gradient(${background.angle ?? 135}deg, ${toAlpha(background.colors[0])}, ${toAlpha(background.colors[1])})`,
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

      {/* Outer container sized to iconSize; canvas always renders at ICON_BASE_SIZE
          and is scaled via CSS so borders/effects stay proportional at all zoom levels. */}
      <div className="relative" style={{ width: iconSize, height: iconSize }}>
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
