import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import {
  $iconName, $iconModified, updateBackground, $background,
  setIconName, bgColorsFromHueTint,
} from '../../store/iconStore';
import {
  $lightAngle, $zoom, setLightAngle, setZoom, ZOOM_LEVELS,
  LIGHT_ANGLE_LEVELS, LIGHT_ANGLE_LABELS,
} from '../../store/uiStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert internal angle (0°=right, CCW positive) to display angle (0°=top, CW positive).
 *  e.g. 135 → -45,  45 → +45,  90 → 0,  180 → -90 */
function toDisplayAngle(a: number): number {
  return ((90 - a + 540) % 360) - 180;
}

/** Extract hue (0–360), saturation (0–100) and lightness (0–100) from hex. */
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;
  const d   = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r)      h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return { h: Math.round((h / 6) * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const PRESET_HUES = [
  { hue: 220, label: 'Blue',   color: 'hsl(220,80%,55%)' },
  { hue: 239, label: 'Indigo', color: 'hsl(239,68%,57%)' },
  { hue: 270, label: 'Purple', color: 'hsl(270,70%,55%)' },
  { hue: 330, label: 'Pink',   color: 'hsl(330,80%,60%)' },
  { hue: 0,   label: 'Red',    color: 'hsl(0,80%,55%)'   },
  { hue: 25,  label: 'Orange', color: 'hsl(25,85%,55%)'  },
  { hue: 50,  label: 'Yellow', color: 'hsl(50,85%,55%)'  },
  { hue: 140, label: 'Green',  color: 'hsl(140,65%,45%)' },
  { hue: 161, label: 'Mint',   color: 'hsl(161,60%,50%)' },
  { hue: 183, label: 'Teal',   color: 'hsl(183,65%,42%)' },
  { hue: 190, label: 'Cyan',   color: 'hsl(190,75%,45%)' },
  { hue: 28,  label: 'Brown',  color: 'hsl(28,38%,42%)'  },
];

// ─── Gradient slider ──────────────────────────────────────────────────────────

function GradientSlider({
  value, min, max, trackGradient, thumbColor, onChange,
}: {
  value: number; min: number; max: number;
  trackGradient: string; thumbColor: string;
  onChange: (v: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;

  const valueFromPointer = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(min + ratio * (max - min));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    onChange(valueFromPointer(e.clientX));
    const onMove = (ev: MouseEvent) => onChange(valueFromPointer(ev.clientX));
    const onUp   = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={trackRef}
      className="relative h-5 flex items-center cursor-pointer select-none"
      onMouseDown={handleMouseDown}
    >
      <div
        className="absolute left-0 right-0 h-[10px] rounded-full"
        style={{ background: trackGradient, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)' }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-[14px] h-[14px] rounded-full pointer-events-none"
        style={{
          left: `calc(${pct}% - 7px)`,
          background: thumbColor,
          boxShadow: '0 1px 4px rgba(0,0,0,0.5), 0 0 0 1.5px rgba(255,255,255,0.25)',
        }}
      />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TopToolbar() {
  const name        = useStore($iconName);
  const modified    = useStore($iconModified);
  const lightAngle  = useStore($lightAngle);
  const zoom        = useStore($zoom);
  const bg          = useStore($background);

  const [showBgPicker,   setShowBgPicker]  = useState(false);
  const [showZoomMenu,   setShowZoomMenu]  = useState(false);
  const [showLightMenu,  setShowLightMenu] = useState(false);
  const [editingName,    setEditingName]   = useState(false);
  const [nameInput,      setNameInput]     = useState(name);

  const bgPickerRef   = useRef<HTMLDivElement>(null);
  const zoomMenuRef   = useRef<HTMLDivElement>(null);
  const lightMenuRef  = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const hue        = bg.hue        ?? 220;
  const tint       = bg.tint       ?? 20;
  const brightness = bg.brightness ?? 100;

  // ── Click-outside handler ─────────────────────────────────────────────────
  useEffect(() => {
    if (!showBgPicker && !showZoomMenu && !showLightMenu) return;
    const handle = (e: MouseEvent) => {
      if (showBgPicker  && bgPickerRef.current  && !bgPickerRef.current.contains(e.target as Node))
        setShowBgPicker(false);
      if (showZoomMenu  && zoomMenuRef.current  && !zoomMenuRef.current.contains(e.target as Node))
        setShowZoomMenu(false);
      if (showLightMenu && lightMenuRef.current && !lightMenuRef.current.contains(e.target as Node))
        setShowLightMenu(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showBgPicker, showZoomMenu, showLightMenu]);

  // ── Icon name ─────────────────────────────────────────────────────────────
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
        const dir     = dx > 0 ? 1 : -1;
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

  // ── Background ───────────────────────────────────────────────────────────
  const handleHueChange        = (h: number) =>
    updateBackground({ type: 'gradient', hue: h,   tint,      brightness, colors: bgColorsFromHueTint(h,   tint,   brightness), angle: 135 });
  const handleTintChange       = (t: number) =>
    updateBackground({ type: 'gradient', hue,      tint: t,   brightness, colors: bgColorsFromHueTint(hue, t,      brightness), angle: 135 });
  const handleBrightnessChange = (bv: number) =>
    updateBackground({ type: 'gradient', hue,      tint,      brightness: bv, colors: bgColorsFromHueTint(hue, tint, bv), angle: 135 });

  const handleCustomColor = (hex: string) => {
    const { h, s, l } = hexToHSL(hex);
    // s → tint: bgColorsFromHueTint uses s1 = 85 * (1 - t)  →  t = (1 - s/85) → tint = t * 100
    const newTint       = Math.round(Math.min(100, Math.max(0, (1 - s / 85) * 100)));
    const newBrightness = Math.min(100, Math.max(0, l * 2));
    updateBackground({ type: 'gradient', hue: h, tint: newTint, brightness: newBrightness, colors: bgColorsFromHueTint(h, newTint, newBrightness), angle: 135 });
  };

  const sat         = Math.round(85 * (1 - tint / 100));
  const l1cur       = Math.round((48 + tint * 0.28) * brightness / 100);
  const hueTrack    = [0,30,60,90,120,150,180,210,240,270,300,330,360].map((h) => `hsl(${h},100%,50%)`).join(', ');
  const tintTrack   = `linear-gradient(to right, hsl(${hue},85%,${Math.round(48 * brightness / 100)}%), hsl(${hue},0%,${Math.round(76 * brightness / 100)}%))`;
  const brightTrack = `linear-gradient(to right, #000, hsl(${hue},${sat}%,${Math.round(48 + tint * 0.28)}%))`;
  const currentHue  = `hsl(${hue},100%,50%)`;
  const currentTint = `hsl(${hue},${sat}%,${l1cur}%)`;
  const currentBright = `hsl(${hue},${sat}%,${l1cur}%)`;
  const bgPreview       = `linear-gradient(135deg, ${bgColorsFromHueTint(hue, tint, brightness).join(', ')})`;

  return (
    <div
      className="flex items-center h-11 px-3 select-none relative z-20"
      style={{
        background: 'rgba(22,22,24,0.82)',
        backdropFilter: 'blur(32px) saturate(200%)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Left — icon name */}
      <div className="flex items-center gap-2 min-w-[160px]">
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') cancelName(); }}
            className="text-[11px] font-medium rounded-[6px] px-2 py-0.5 focus:outline-none w-32"
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
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.30)' }} title="Unsaved changes" />
        )}
      </div>

      {/* Center — tools */}
      <div className="flex-1 flex items-center justify-center gap-2">

        {/* ── Background picker ── */}
        <div ref={bgPickerRef} className="relative">
          <button
            onClick={() => setShowBgPicker(!showBgPicker)}
            className="flex items-center gap-2 px-2.5 py-[5px] rounded-[8px] transition-all duration-150"
            style={{ background: 'rgba(255,255,255,0.055)', border: '0.5px solid rgba(255,255,255,0.09)' }}
            title="Background color"
          >
            <div
              className="w-[18px] h-[18px] rounded-[5px] flex-shrink-0"
              style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.15)' }}
            />
            <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.50)' }}>Background</span>
            <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'rgba(255,255,255,0.30)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showBgPicker && (
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 p-4 rounded-[16px] w-64 shadow-2xl"
              style={{
                background: 'rgba(30,30,32,0.95)',
                backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 0.5px 0 rgba(255,255,255,0.08)',
              }}
            >
              {/* Clickable preview → native color picker → extract hue */}
              <div className="relative mb-4 group">
                <div
                  className="w-full h-10 rounded-[10px] cursor-pointer"
                  style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.12)' }}
                  onClick={() => colorInputRef.current?.click()}
                  title="Click to pick custom color"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-[10px]"
                  style={{ background: 'rgba(0,0,0,0.3)' }}>
                  <span className="text-[10px] text-white font-medium">Custom color</span>
                </div>
                <input
                  ref={colorInputRef}
                  type="color"
                  className="absolute opacity-0 w-0 h-0 pointer-events-none"
                  onChange={(e) => handleCustomColor(e.target.value)}
                />
              </div>

              {/* Hue slider */}
              <div className="mb-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.30)' }}>
                  Hue
                </span>
                <GradientSlider
                  value={hue} min={0} max={360}
                  trackGradient={`linear-gradient(to right, ${hueTrack})`}
                  thumbColor={currentHue}
                  onChange={handleHueChange}
                />
              </div>

              {/* Tint slider */}
              <div className="mb-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.30)' }}>
                  Tint
                </span>
                <GradientSlider
                  value={tint} min={0} max={100}
                  trackGradient={tintTrack}
                  thumbColor={currentTint}
                  onChange={handleTintChange}
                />
              </div>

              {/* Brightness slider */}
              <div className="mb-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.30)' }}>
                  Brightness
                </span>
                <GradientSlider
                  value={brightness} min={0} max={100}
                  trackGradient={brightTrack}
                  thumbColor={currentBright}
                  onChange={handleBrightnessChange}
                />
              </div>

              {/* Preset swatches */}
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.30)' }}>
                  Presets
                </span>
                <div className="grid grid-cols-6 gap-1.5">
                  {PRESET_HUES.map(({ hue: h, label, color }) => (
                    <button
                      key={h}
                      title={label}
                      onClick={() => handleHueChange(h)}
                      className="w-7 h-7 rounded-lg transition-transform hover:scale-110 active:scale-95"
                      style={{
                        background: color,
                        boxShadow: hue === h
                          ? '0 0 0 2px rgba(255,255,255,0.9), 0 2px 8px rgba(0,0,0,0.4)'
                          : '0 0 0 0.5px rgba(255,255,255,0.15), 0 1px 4px rgba(0,0,0,0.3)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Light angle ── */}
        <div ref={lightMenuRef} className="relative">
          <button
            onClick={() => setShowLightMenu(!showLightMenu)}
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <svg
              className="w-4 h-4 flex-shrink-0 cursor-ew-resize"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
              style={{ color: 'rgba(255,255,255,0.40)' }}
              onMouseDown={(e) => { e.stopPropagation(); handleLightIconMouseDown(e); }}
              title="Drag to step light angle"
            >
              {/* Sun with directional rays — light position */}
              <circle cx="12" cy="12" r="3.5" strokeWidth={1.5} />
              <path strokeLinecap="round" strokeWidth={1.5} d="M12 2.5V5" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M12 19v2.5" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M2.5 12H5" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M19 12h2.5" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M5.2 5.2l1.6 1.6" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M17.2 17.2l1.6 1.6" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M5.2 18.8l1.6-1.6" />
              <path strokeLinecap="round" strokeWidth={1.5} d="M17.2 6.8l1.6-1.6" />
            </svg>
            <span className="tabular-nums">{toDisplayAngle(lightAngle)}°</span>
            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
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
              {LIGHT_ANGLE_LEVELS.map((a) => (
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

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Zoom ── */}
        <div ref={zoomMenuRef} className="relative">
          <button
            onClick={() => setShowZoomMenu(!showZoomMenu)}
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <svg
              className="w-4 h-4 flex-shrink-0 cursor-ew-resize"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
              style={{ color: 'rgba(255,255,255,0.40)' }}
              onMouseDown={(e) => { e.stopPropagation(); handleZoomIconMouseDown(e); }}
              title="Drag to step zoom"
            >
              <circle cx="11" cy="11" r="7" strokeWidth={1.8} />
              <path strokeLinecap="round" strokeWidth={1.8} d="M21 21l-4-4" />
            </svg>
            <span className="tabular-nums">{zoom}%</span>
            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showZoomMenu && (
            <div
              className="absolute top-full right-0 mt-2 z-50 py-1.5 rounded-[12px] shadow-xl min-w-[90px]"
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
                  className="w-full text-left px-3 py-[5px] text-[11px] font-medium transition-colors"
                  style={{ color: zoom === z ? '#0a84ff' : 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={(e) => ((e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => ((e.target as HTMLElement).style.background = 'transparent')}
                >
                  {z}%
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right — Export */}
      <div className="flex items-center gap-2 min-w-[160px] justify-end">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('icon-export'))}
          className="px-3.5 py-[5px] text-[11px] font-semibold rounded-[8px] transition-all duration-150"
          style={{
            background: 'linear-gradient(180deg, rgba(10,132,255,1) 0%, rgba(0,102,220,1) 100%)',
            color: '#ffffff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4), inset 0 0.5px 0 rgba(255,255,255,0.25)',
          }}
        >
          Export
        </button>
      </div>
    </div>
  );
}
