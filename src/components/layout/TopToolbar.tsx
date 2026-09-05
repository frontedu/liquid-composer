import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { CaretDown, Sun, MagnifyingGlass } from '@phosphor-icons/react';
import type { ExportOptions } from '../../engine/IconRenderer';
import { BackgroundControls } from '../inspector/BackgroundControls';
import {
  $iconName, $iconModified, $background,
  setIconName, bgColorsFromHueTint,
} from '../../store/iconStore';
import {
  $lightAngle, $zoom, setLightAngle, setZoom, ZOOM_LEVELS,
  LIGHT_ANGLE_LEVELS, LIGHT_ANGLE_LABELS,
} from '../../store/uiStore';

function toDisplayAngle(a: number): number {
  return ((90 - a + 540) % 360) - 180;
}

const DEFAULT_EXPORT: ExportOptions = { format: 'png', size: 1024 };
const EXPORT_OPTIONS: ExportOptions[] = [
  { format: 'png',  size: 4096 },
  { format: 'png',  size: 2048 },
  { format: 'png',  size: 512 },
  { format: 'png',  size: 256 },
  { format: 'jpeg', size: 1024 },
  { format: 'webp', size: 1024 },
];
const FORMAT_LABEL: Record<ExportOptions['format'], string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

export function TopToolbar() {
  const name        = useStore($iconName);
  const modified    = useStore($iconModified);
  const lightAngle  = useStore($lightAngle);
  const zoom        = useStore($zoom);
  const bg          = useStore($background);

  const [showBgPicker,   setShowBgPicker]  = useState(false);
  const [showZoomMenu,   setShowZoomMenu]  = useState(false);
  const [showLightMenu,  setShowLightMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [editingName,    setEditingName]   = useState(false);
  const [nameInput,      setNameInput]     = useState(name);

  const bgPickerRef   = useRef<HTMLDivElement>(null);
  const zoomMenuRef   = useRef<HTMLDivElement>(null);
  const lightMenuRef  = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showBgPicker && !showZoomMenu && !showLightMenu && !showExportMenu) return;
    const handle = (e: MouseEvent) => {
      if (showBgPicker  && bgPickerRef.current  && !bgPickerRef.current.contains(e.target as Node))
        setShowBgPicker(false);
      if (showZoomMenu  && zoomMenuRef.current  && !zoomMenuRef.current.contains(e.target as Node))
        setShowZoomMenu(false);
      if (showLightMenu && lightMenuRef.current && !lightMenuRef.current.contains(e.target as Node))
        setShowLightMenu(false);
      if (showExportMenu && exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showBgPicker, showZoomMenu, showLightMenu, showExportMenu]);

  const exportAs = (detail: ExportOptions) => {
    window.dispatchEvent(new CustomEvent<ExportOptions>('icon-export', { detail }));
    setShowExportMenu(false);
  };

  const commitName = () => { setIconName(nameInput); setEditingName(false); };
  const cancelName = () => setEditingName(false);

  // ── Light angle — drag steps through LIGHT_ANGLE_LEVELS (like zoom) ───────
  const lightDragRef = useRef<{ lastStepX: number } | null>(null);
  const LIGHT_STEP_PX = 40;
  const handleLightIconMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't open dropdown on drag
    lightDragRef.current = { lastStepX: e.clientX };
    const onMove = (ev: MouseEvent) => {
      if (!lightDragRef.current) return;
      const dx = ev.clientX - lightDragRef.current.lastStepX;
      if (Math.abs(dx) >= LIGHT_STEP_PX) {
        const dir     = dx > 0 ? -1 : 1;
        const current = $lightAngle.get();
        const idx     = LIGHT_ANGLE_LEVELS.indexOf(current as any);
        if (idx === -1) {
          // Snap to nearest preset first
          const nearest = [...LIGHT_ANGLE_LEVELS].reduce((a, b) =>
            Math.abs(b - current) < Math.abs(a - current) ? b : a);
          setLightAngle(nearest);
        } else {
          const next = idx + dir;
          if (next >= 0 && next < LIGHT_ANGLE_LEVELS.length)
            setLightAngle(LIGHT_ANGLE_LEVELS[next]);
        }
        lightDragRef.current.lastStepX = ev.clientX;
      }
    };
    const onUp = () => {
      lightDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Drag on zoom icon to step through predefined levels
  const zoomDragRef = useRef<{ startX: number; lastStepX: number } | null>(null);
  const handleZoomIconMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    zoomDragRef.current = { startX: e.clientX, lastStepX: e.clientX };
    const STEP_PX = 30; // pixels to move before stepping zoom
    const onMove  = (ev: MouseEvent) => {
      if (!zoomDragRef.current) return;
      const dx = ev.clientX - zoomDragRef.current.lastStepX;
      if (Math.abs(dx) >= STEP_PX) {
        const dir = dx > 0 ? 1 : -1;
        const current = $zoom.get();
        if (dir > 0) {
          const next = ZOOM_LEVELS.find((z) => z > current);
          if (next !== undefined) setZoom(next);
        } else {
          const prev = [...ZOOM_LEVELS].reverse().find((z) => z < current);
          if (prev !== undefined) setZoom(prev);
        }
        zoomDragRef.current.lastStepX = ev.clientX;
      }
    };
    const onUp = () => {
      zoomDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const bgPreview = bg.bgType === 'custom' && bg.stops?.length
    ? `linear-gradient(135deg, ${bg.stops.map(s => s.color).join(', ')})`
    : `linear-gradient(135deg, ${bgColorsFromHueTint(bg.hue ?? 220, bg.tint ?? 20, bg.brightness ?? 100).join(', ')})`;

  return (
    <div
      className="flex items-center h-11 pl-3 pr-2 select-none relative z-20"
      style={{
        background: 'rgba(13,13,16,0.85)',
        backdropFilter: 'blur(32px) saturate(200%)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex items-center gap-2 min-w-[160px]">
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') cancelName(); }}
            className="text-[11px] font-medium rounded-[6px] px-2 py-0.5 focus:outline-hidden w-32"
            style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(10,132,255,0.8)', color: '#ffffff' }}
          />
        ) : (
          <button
            onDoubleClick={() => { setNameInput(name); setEditingName(true); }}
            title="Double-click to rename"
            className="text-[11px] font-semibold truncate max-w-[128px] cursor-text text-left"
            style={{ color: 'rgba(255,255,255,0.80)' }}
          >
            {name}
          </button>
        )}
        {modified && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.30)' }} title="Unsaved changes" />
        )}
      </div>

      <div className="flex-1 flex items-center justify-center gap-2">

        <div ref={bgPickerRef} className="relative">
          <button
            onClick={() => setShowBgPicker(!showBgPicker)}
            className="flex items-center gap-2 px-2.5 py-[5px] rounded-[8px] transition-all duration-150"
            style={{ background: 'rgba(255,255,255,0.055)', border: '0.5px solid rgba(255,255,255,0.09)' }}
            title="Background color"
          >
            <div
              className="w-[18px] h-[18px] rounded-[5px] shrink-0"
              style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.15)' }}
            />
            <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.50)' }}>Background</span>
            <CaretDown size={10} weight="bold" style={{ color: 'rgba(255,255,255,0.30)' }} />
          </button>

          {showBgPicker && (
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 rounded-[16px] w-64 shadow-2xl overflow-hidden"
              style={{
                background: 'rgba(30,30,32,0.97)',
                backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 0.5px 0 rgba(255,255,255,0.08)',
              }}
            >
              <BackgroundControls />
            </div>
          )}
        </div>

        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        <div ref={lightMenuRef} className="relative">
          <button
            onClick={() => setShowLightMenu(!showLightMenu)}
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <Sun
              size={16}
              weight="bold"
              className="shrink-0 cursor-ew-resize"
              style={{ color: 'rgba(255,255,255,0.40)' }}
              onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handleLightIconMouseDown(e); }}
              aria-label="Drag to step light angle"
            />
            <span className="tabular-nums">{toDisplayAngle(lightAngle)}°</span>
            <CaretDown size={8} weight="bold" style={{ color: 'rgba(255,255,255,0.25)' }} />
          </button>

          {showLightMenu && (
            <div
              className="absolute top-full left-0 mt-2 z-50 py-1.5 rounded-[12px] shadow-xl min-w-[130px]"
              style={{
                background: 'rgba(30,30,32,0.95)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.07)',
              }}
            >
              {[...LIGHT_ANGLE_LEVELS].reverse().map((a) => (
                <button
                  key={a}
                  onClick={() => { setLightAngle(a); setShowLightMenu(false); }}
                  className="w-full text-left px-3 py-[5px] text-[11px] font-medium transition-colors flex items-center justify-between gap-3"
                  style={{ color: lightAngle === a ? '#0a84ff' : 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span>{LIGHT_ANGLE_LABELS[a]}</span>
                  <span className="tabular-nums" style={{ color: lightAngle === a ? '#0a84ff' : 'rgba(255,255,255,0.30)' }}>{toDisplayAngle(a)}°</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        <div ref={zoomMenuRef} className="relative">
          <button
            onClick={() => setShowZoomMenu(!showZoomMenu)}
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <MagnifyingGlass
              size={16}
              weight="bold"
              className="shrink-0 cursor-ew-resize"
              style={{ color: 'rgba(255,255,255,0.40)' }}
              onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handleZoomIconMouseDown(e); }}
              aria-label="Drag to step zoom"
            />
            <span className="tabular-nums">{zoom}%</span>
            <CaretDown size={8} weight="bold" style={{ color: 'rgba(255,255,255,0.25)' }} />
          </button>

          {showZoomMenu && (
            <div
              className="absolute top-full right-0 mt-2 z-50 py-1.5 rounded-[12px] shadow-xl min-w-[110px]"
              style={{
                background: 'rgba(30,30,32,0.95)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.07)',
              }}
            >
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  onClick={() => { setZoom(z); setShowZoomMenu(false); }}
                  className="w-full text-left px-3 py-[5px] text-[11px] font-medium transition-colors flex items-center justify-between gap-3"
                  style={{ color: zoom === z ? '#0a84ff' : 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span>{z}%</span>
                  <span className="tabular-nums" style={{ color: zoom === z ? '#0a84ff' : 'rgba(255,255,255,0.30)' }}>{Math.round(1024 * (z / 100))}pt</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-[160px] justify-end">
        <div ref={exportMenuRef} className="relative">
          <div
            className="flex items-stretch rounded-full overflow-hidden transition-transform duration-150 active:scale-[0.97]"
            style={{
              background: 'rgba(10,132,255,0.88)',
              color: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.30), inset 0 0.5px 0 rgba(255,255,255,0.35)',
            }}
          >
            <button
              onClick={() => exportAs(DEFAULT_EXPORT)}
              className="pl-4 pr-3 py-[6px] text-[11px] font-semibold tracking-tight"
            >
              Export
            </button>
            <div className="w-px my-[6px]" style={{ background: 'rgba(255,255,255,0.22)' }} />
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              aria-label="More export options"
              aria-haspopup="menu"
              aria-expanded={showExportMenu}
              className="pl-2 pr-2.5 flex items-center"
            >
              <CaretDown size={9} weight="bold" />
            </button>
          </div>

          {showExportMenu && (
            <div
              role="menu"
              className="absolute top-full right-0 mt-2 z-50 py-1.5 rounded-[12px] shadow-xl min-w-[150px]"
              style={{
                background: 'rgba(30,30,32,0.95)',
                backdropFilter: 'blur(40px)',
                WebkitBackdropFilter: 'blur(40px)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.07)',
              }}
            >
              {EXPORT_OPTIONS.map((opt) => (
                <button
                  key={`${opt.format}-${opt.size}`}
                  role="menuitem"
                  onClick={() => exportAs(opt)}
                  className="w-full text-left px-3 py-[5px] text-[11px] font-medium transition-colors flex items-center justify-between gap-3"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <span>{FORMAT_LABEL[opt.format]}{opt.size === 4096 ? ' · 4K' : opt.size === 2048 ? ' · 2K' : ''}</span>
                  <span className="tabular-nums" style={{ color: 'rgba(255,255,255,0.30)' }}>({opt.size} px)</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
