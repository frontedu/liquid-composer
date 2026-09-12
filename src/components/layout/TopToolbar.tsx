import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { CaretDown, Check, Sun, MagnifyingGlass, DownloadSimple } from '@phosphor-icons/react';
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
  { format: 'png',  size: 1024, clipboard: true },
  { format: 'png',  size: 4096 },
  { format: 'png',  size: 2048 },
  { format: 'png',  size: 1024 },
  { format: 'png',  size: 512 },
  { format: 'png',  size: 256 },
  { format: 'jpeg', size: 1024 },
  { format: 'png',  size: 1024, allModes: true },
];
const FORMAT_LABEL: Record<ExportOptions['format'], string> = { png: 'PNG', jpeg: 'JPEG' };
type ToolbarPopover = 'background' | 'light' | 'zoom' | 'export';

function exportLabel(opt: ExportOptions): string {
  if (opt.clipboard) return 'Copy PNG';
  if (opt.allModes)  return 'All Appearances';
  return `${FORMAT_LABEL[opt.format]}${opt.size === 4096 ? ' · 4K' : opt.size === 2048 ? ' · 2K' : ''}`;
}

export function TopToolbar() {
  const name        = useStore($iconName);
  const modified    = useStore($iconModified);
  const lightAngle  = useStore($lightAngle);
  const zoom        = useStore($zoom);
  const bg          = useStore($background);

  const [openPopover, setOpenPopover] = useState<ToolbarPopover | null>(null);
  const [editingName,    setEditingName]   = useState(false);
  const [nameInput,      setNameInput]     = useState(name);

  const bgPickerRef   = useRef<HTMLDivElement>(null);
  const zoomMenuRef   = useRef<HTMLDivElement>(null);
  const lightMenuRef  = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openPopover) return;
    const refs = { background: bgPickerRef, zoom: zoomMenuRef, light: lightMenuRef, export: exportMenuRef };
    const container = refs[openPopover].current;
    const popover = container?.querySelector<HTMLElement>('.editor-popover');
    const selected = popover?.querySelector<HTMLElement>('[aria-checked="true"]');
    (selected ?? popover?.querySelector<HTMLElement>('button, input, select'))?.focus();
    const handle = (e: MouseEvent) => {
      if (!container?.contains(e.target as Node)) setOpenPopover(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpenPopover(null);
      container?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openPopover]);

  const togglePopover = (popover: ToolbarPopover) => setOpenPopover((current) => current === popover ? null : popover);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const exportAs = (detail: ExportOptions) => {
    window.dispatchEvent(new CustomEvent<ExportOptions>('icon-export', { detail }));
    setOpenPopover(null);
    exportMenuRef.current?.querySelector('button')?.focus();
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
    <header
      className="editor-toolbar"
      onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpenPopover(null); }}
    >
      <div className="editor-document">
        {editingName ? (
          <input
            autoFocus
            type="text"
            aria-label="Document name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') cancelName(); }}
            className="editor-document-input"
          />
        ) : (
          <button
            onDoubleClick={() => { setNameInput(name); setEditingName(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault();
                setNameInput(name);
                setEditingName(true);
              }
            }}
            title="Double-click to rename"
            className="editor-document-name"
          >
            {name}
          </button>
        )}
        {modified && <span className="editor-document-modified" title="Unsaved changes" />}
      </div>

      <div className="editor-toolbar-tools">
        <div ref={bgPickerRef} className="relative">
          <button
            onClick={() => togglePopover('background')}
            className="editor-tool-button"
            title="Background color"
            aria-haspopup="dialog"
            aria-expanded={openPopover === 'background'}
            aria-controls="background-popover"
          >
            <span className="editor-color-swatch" style={{ background: bgPreview }} />
            <span>Background</span>
            <CaretDown size={10} weight="bold" className="editor-chevron" />
          </button>
          {openPopover === 'background' && (
            <div
              id="background-popover"
              role="dialog"
              aria-label="Background color"
              className="editor-popover editor-background-popover"
            >
              <div className="editor-popover-heading">Background</div>
              <BackgroundControls />
            </div>
          )}
        </div>

        <div className="editor-tool-group">
          <div ref={lightMenuRef} className="relative">
            <button
              onClick={() => togglePopover('light')}
              className="editor-tool-button"
              title="Light angle"
              aria-label={`Light angle: ${toDisplayAngle(lightAngle)} degrees`}
              aria-haspopup="menu"
              aria-expanded={openPopover === 'light'}
              aria-controls="light-menu"
            >
              <Sun size={17} className="cursor-ew-resize" onMouseDown={handleLightIconMouseDown} />
              <span className="tabular-nums">{toDisplayAngle(lightAngle)}°</span>
              <CaretDown size={10} weight="bold" className="editor-chevron" />
            </button>
            {openPopover === 'light' && (
              <div id="light-menu" role="menu" aria-label="Light angle" className="editor-popover editor-menu left-0" onKeyDown={handleMenuKeyDown}>
                {[...LIGHT_ANGLE_LEVELS].reverse().map((a) => (
                  <button
                    key={a}
                    role="menuitemradio"
                    aria-checked={lightAngle === a}
                    tabIndex={-1}
                    onClick={() => { setLightAngle(a); setOpenPopover(null); lightMenuRef.current?.querySelector('button')?.focus(); }}
                    className="editor-menu-item"
                  >
                    <Check size={13} weight="bold" className={lightAngle === a ? '' : 'invisible'} />
                    <span>{LIGHT_ANGLE_LABELS[a]}</span>
                    <span className="editor-menu-detail">{toDisplayAngle(a)}°</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="editor-tool-divider" aria-hidden="true" />
          <div ref={zoomMenuRef} className="relative">
            <button
              onClick={() => togglePopover('zoom')}
              className="editor-tool-button"
              title="Zoom"
              aria-label={`Zoom: ${zoom} percent`}
              aria-haspopup="menu"
              aria-expanded={openPopover === 'zoom'}
              aria-controls="zoom-menu"
            >
              <MagnifyingGlass size={17} className="cursor-ew-resize" onMouseDown={handleZoomIconMouseDown} />
              <span className="tabular-nums">{zoom}%</span>
              <CaretDown size={10} weight="bold" className="editor-chevron" />
            </button>
            {openPopover === 'zoom' && (
              <div id="zoom-menu" role="menu" aria-label="Zoom" className="editor-popover editor-menu right-0" onKeyDown={handleMenuKeyDown}>
                {ZOOM_LEVELS.map((z) => (
                  <button
                    key={z}
                    role="menuitemradio"
                    aria-checked={zoom === z}
                    tabIndex={-1}
                    onClick={() => { setZoom(z); setOpenPopover(null); zoomMenuRef.current?.querySelector('button')?.focus(); }}
                    className="editor-menu-item"
                  >
                    <Check size={13} weight="bold" className={zoom === z ? '' : 'invisible'} />
                    <span>{z}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="editor-toolbar-actions">
        <div ref={exportMenuRef} className="relative">
          <div className="editor-export">
            <button onClick={() => exportAs(DEFAULT_EXPORT)} className="editor-export-action" title="Export PNG · 1024 × 1024">
              <DownloadSimple size={16} aria-hidden="true" />
              Export
            </button>
            <button
              onClick={() => togglePopover('export')}
              aria-label="More export options"
              aria-haspopup="menu"
              aria-expanded={openPopover === 'export'}
              aria-controls="export-menu"
              className="editor-export-options"
            >
              <CaretDown size={10} weight="bold" />
            </button>
          </div>
          {openPopover === 'export' && (
            <div id="export-menu" role="menu" aria-label="Export" className="editor-popover editor-menu right-0" onKeyDown={handleMenuKeyDown}>
              {EXPORT_OPTIONS.map((opt) => (
                <button
                  key={opt.clipboard ? 'clipboard' : opt.allModes ? 'zip' : `${opt.format}-${opt.size}`}
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => exportAs(opt)}
                  className={`editor-menu-item ${opt.allModes || opt.size === 4096 ? 'editor-menu-separated' : ''}`}
                >
                  <span>{exportLabel(opt)}</span>
                  <span className="editor-menu-detail">{opt.allModes ? 'ZIP' : `${opt.size} px`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
