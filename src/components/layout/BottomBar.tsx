import React, { useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, $background } from '../../store/iconStore';
import { $appearanceMode, setAppearanceMode } from '../../store/uiStore';
import type { AppearanceMode } from '../../types/index';
import { renderIconToCanvas } from '../../engine/IconRenderer';

interface ThumbProps {
  mode: AppearanceMode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function IconThumb({ mode, label, active, onClick }: ThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layers = useStore($layers);
  const background = useStore($background);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderIconToCanvas(canvas, { layers, background, lightAngle: -45, appearanceMode: mode, size: 32 });
  }, [layers, background, mode]);

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-1 rounded transition-colors
        ${active ? 'bg-[#2a2a2a]' : 'hover:bg-[#2a2a2a]'}`}
    >
      <canvas
        ref={canvasRef}
        width={32}
        height={32}
        className="rounded-[7px]"
        style={{ imageRendering: 'pixelated' }}
      />
      <span className="text-2xs text-[#636366]">{label}</span>
    </button>
  );
}

export function BottomBar() {
  const mode = useStore($appearanceMode);

  return (
    <div className="flex items-center justify-between h-14 bg-[#1c1c1e] border-t border-[#2c2c2e] px-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#636366]">iOS, macOS</span>
        <div className="flex items-center gap-1">
          <IconThumb mode="default" label="Default" active={mode === 'default'} onClick={() => setAppearanceMode('default')} />
          <IconThumb mode="dark" label="Dark" active={mode === 'dark'} onClick={() => setAppearanceMode('dark')} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-[#636366]">Variants</span>
        <div className="flex items-center gap-1">
          <IconThumb mode="default" label="Default" active={mode === 'default'} onClick={() => setAppearanceMode('default')} />
          <IconThumb mode="dark" label="Dark" active={mode === 'dark'} onClick={() => setAppearanceMode('dark')} />
          <IconThumb mode="mono" label="Mono" active={mode === 'mono'} onClick={() => setAppearanceMode('mono')} />
        </div>
      </div>
    </div>
  );
}
