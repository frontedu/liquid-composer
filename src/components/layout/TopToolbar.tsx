import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { CaretDown, Sun, MagnifyingGlass } from '@phosphor-icons/react';
import {
  $iconName, $iconModified, updateBackground, $background,
  setIconName, bgColorsFromHueTint,
} from '../../store/iconStore';
import {
  $lightAngle, $zoom, setLightAngle, setZoom, ZOOM_LEVELS,
  LIGHT_ANGLE_LEVELS, LIGHT_ANGLE_LABELS, $webgl2Status, $webgl2Error,
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

const PRESET_COLORS = [
  // Row 1 — vivid + blues (7)
  { hex: '#FF3B30', label: 'Red'    },
  { hex: '#FF9500', label: 'Orange' },
  { hex: '#FFCC00', label: 'Yellow' },
  { hex: '#34C759', label: 'Green'  },
  { hex: '#00C7BE', label: 'Teal'   },
  { hex: '#007AFF', label: 'Blue'   },
  { hex: '#5AC8FA', label: 'Sky'    },
  // Row 2 — cool + neutrals, mid-gray removed (7)
  { hex: '#FF2D55', label: 'Pink'   },
  { hex: '#5856D6', label: 'Indigo' },
  { hex: '#AF52DE', label: 'Purple' },
  { hex: '#F2F2F7', label: 'White'      },
  { hex: '#C7C7CC', label: 'Light Gray' },
  { hex: '#48484A', label: 'Dark Gray'  },
  { hex: '#1C1C1E', label: 'Near Black'  },
];

// ─── Gradient slider ──────────────────────────────────────────────────────────

function GradientSlider({
  value, min, max, trackGradient, thumbColor, onChange, onRelease,
}: {
  value: number; min: number; max: number;
  trackGradient: string; thumbColor: string;
  onChange: (v: number) => void;
  onRelease?: (v: number) => void;
}) {
  const trackRef  = React.useRef<HTMLDivElement>(null);
  const lastVal   = React.useRef(value);
  const pct = ((value - min) / (max - min)) * 100;

  const valueFromPointer = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(min + ratio * (max - min));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = trackRef.current!.getBoundingClientRect();
    const thumbX = rect.left + (pct / 100) * rect.width;
    if (Math.abs(e.clientX - thumbX) > 10) {
      const v = valueFromPointer(e.clientX);
      lastVal.current = v;
      onChange(v);
    }
    const onMove = (ev: MouseEvent) => {
      const v = valueFromPointer(ev.clientX);
      lastVal.current = v;
      onChange(v);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onRelease?.(lastVal.current); // flush final value immediately
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
  const webgl2Status = useStore($webgl2Status);
  const webgl2Error = useStore($webgl2Error);
  const webglPopoverText =
    webgl2Status === 'active'
      ? 'WebGL2 active'
      : webgl2Status === 'error'
        ? `WebGL2 error: ${webgl2Error || 'Unknown error'}`
        : 'WebGL2 inactive (Canvas 2D)';

  const [showBgPicker,   setShowBgPicker]  = useState(false);
  const [showZoomMenu,   setShowZoomMenu]  = useState(false);
  const [showLightMenu,  setShowLightMenu] = useState(false);
  const [editingName,    setEditingName]   = useState(false);
  const [nameInput,      setNameInput]     = useState(name);

  const bgPickerRef   = useRef<HTMLDivElement>(null);
  const zoomMenuRef   = useRef<HTMLDivElement>(null);
  const lightMenuRef  = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const storeBgType     = bg.bgType     ?? 'preset';
  const storeStops      = bg.stops      ?? [{ offset: 0, color: '#2a2a2e' }, { offset: 1, color: '#1a1a1e' }];
  const storeHue        = bg.hue        ?? 220;
  const storeTint       = bg.tint       ?? 20;
  const storeBrightness = bg.brightness ?? 100;

  // Local state — updates immediately so sliders feel instant
  const [localBgType,     setLocalBgType]     = useState(storeBgType);
  const [localStops,      setLocalStops]      = useState(storeStops);
  const [localHue,        setLocalHue]        = useState(storeHue);
  const [localTint,       setLocalTint]       = useState(storeTint);
  const [localBrightness, setLocalBrightness] = useState(storeBrightness);

  const hue        = localHue;
  const tint       = localTint;
  const brightness = localBrightness;

  // Ref holds latest values without causing re-renders — read inside RAF callback
  const bgValuesRef = useRef({ type: storeBgType, stops: storeStops, hue: storeHue, tint: storeTint, brightness: storeBrightness });
  const rafRef      = useRef(0);

  const flushUpdate = useCallback(() => {
    if (rafRef.current) { clearTimeout(rafRef.current); rafRef.current = 0; }
    const { type: t, stops: st, hue: h, tint: ti, brightness: br } = bgValuesRef.current;
    if (t === 'custom') {
      updateBackground({ type: 'gradient', bgType: 'custom', stops: st, angle: 90 });
    } else {
      updateBackground({ type: 'gradient', bgType: 'preset', hue: h, tint: ti, brightness: br, colors: bgColorsFromHueTint(h, ti, br), angle: 90 });
    }
  }, []);

  // Throttle at ~30fps: frequent enough to feel fluid, spaced enough for WebGL to finish
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current) return; // already scheduled, latest values in ref
    rafRef.current = window.setTimeout(() => {
      rafRef.current = 0;
      const { type: t, stops: st, hue: h, tint: ti, brightness: br } = bgValuesRef.current;
      if (t === 'custom') {
        updateBackground({ type: 'gradient', bgType: 'custom', stops: st, angle: 90 });
      } else {
        updateBackground({ type: 'gradient', bgType: 'preset', hue: h, tint: ti, brightness: br, colors: bgColorsFromHueTint(h, ti, br), angle: 90 });
      }
    }, 33);
  }, []);

  // ── Sync local state from store when picker opens ────────────────────────
  // useState initializer only runs once; if persistence loads after mount the
  // local values would be stale. Re-sync every time the picker is opened.
  useEffect(() => {
    if (!showBgPicker) return;
    setLocalBgType(storeBgType);
    setLocalStops(storeStops);
    setLocalHue(storeHue);
    setLocalTint(storeTint);
    setLocalBrightness(storeBrightness);
    bgValuesRef.current = {
      type: storeBgType,
      stops: storeStops,
      hue: storeHue,
      tint: storeTint,
      brightness: storeBrightness,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBgPicker]); // only on open/close, not on every store change

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

  // ── Background ───────────────────────────────────────────────────────────
  const handleHueChange = (h: number) => {
    setLocalHue(h);
    bgValuesRef.current.hue = h;
    scheduleUpdate();
  };
  const handleTintChange = (t: number) => {
    setLocalTint(t);
    bgValuesRef.current.tint = t;
    scheduleUpdate();
  };
  const handleBrightnessChange = (bv: number) => {
    setLocalBrightness(bv);
    bgValuesRef.current.brightness = bv;
    scheduleUpdate();
  };

  const handleCustomColor = (hex: string) => {
    if (localBgType === 'preset') {
      const { h, s, l } = hexToHSL(hex);
      const newTint = Math.round(Math.min(100, Math.max(0, (1 - s / 85) * 100)));
      const l1base = 48 + newTint * 0.52;
      const newBrightness = Math.round(Math.min(100, Math.max(0, (l * 100) / l1base)));
      setLocalHue(h);
      setLocalTint(newTint);
      setLocalBrightness(newBrightness);
      bgValuesRef.current = { ...bgValuesRef.current, type: 'preset', hue: h, tint: newTint, brightness: newBrightness };
    } else {
      const newStops = [...localStops];
      newStops[0] = { ...newStops[0], color: hex };
      setLocalStops(newStops);
      bgValuesRef.current = { ...bgValuesRef.current, type: 'custom', stops: newStops };
    }
    scheduleUpdate();
  };

  const handleStopChange = (index: number, hex: string) => {
    const newStops = [...localStops];
    newStops[index] = { ...newStops[index], color: hex };
    setLocalStops(newStops);
    bgValuesRef.current = { ...bgValuesRef.current, type: 'custom', stops: newStops };
    scheduleUpdate();
  };

  const sat         = Math.round(85 * (1 - tint / 100));
  const l1cur       = Math.min(100, Math.round((48 + tint * 0.52) * brightness / 100));
  const hueTrack    = [0,30,60,90,120,150,180,210,240,270,300,330,360].map((h) => `hsl(${h},100%,50%)`).join(', ');
  const tintTrack   = `linear-gradient(to right, hsl(${hue},85%,${Math.round(48 * brightness / 100)}%), hsl(${hue},0%,${Math.min(100, Math.round(100 * brightness / 100))}%))`;
  const brightTrack = `linear-gradient(to right, #000, hsl(${hue},${sat}%,${Math.min(100, Math.round(48 + tint * 0.52))}%))`;
  const currentHue  = `hsl(${hue},100%,50%)`;
  const currentTint = `hsl(${hue},${sat}%,${l1cur}%)`;
  const currentBright = `hsl(${hue},${sat}%,${l1cur}%)`;
  const bgPreview       = localBgType === 'custom' && localStops.length > 0 
    ? `linear-gradient(135deg, ${localStops.map(s => s.color).join(', ')})`
    : `linear-gradient(135deg, ${bgColorsFromHueTint(hue, tint, brightness).join(', ')})`;

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
              {/* ── Type tabs — always at the very top ── */}
              <div className="flex border-b border-white/[0.06]">
                <button
                  className={`flex-1 text-[11px] font-semibold py-2.5 transition-all ${
                    localBgType === 'preset'
                      ? 'text-white border-b-2 border-[#0a84ff]'
                      : 'text-white/35 hover:text-white/60'
                  }`}
                  style={{ marginBottom: localBgType === 'preset' ? -1 : 0 }}
                  onClick={() => {
                    setLocalBgType('preset');
                    bgValuesRef.current = { ...bgValuesRef.current, type: 'preset' };
                    scheduleUpdate();
                  }}
                >
                  Solid
                </button>
                <button
                  className={`flex-1 text-[11px] font-semibold py-2.5 transition-all ${
                    localBgType === 'custom'
                      ? 'text-white border-b-2 border-[#0a84ff]'
                      : 'text-white/35 hover:text-white/60'
                  }`}
                  style={{ marginBottom: localBgType === 'custom' ? -1 : 0 }}
                  onClick={() => {
                    setLocalBgType('custom');
                    bgValuesRef.current = { ...bgValuesRef.current, type: 'custom' };
                    scheduleUpdate();
                  }}
                >
                  Gradient
                </button>
              </div>

              {localBgType === 'preset' ? (
                /* ── SOLID mode ─────────────────────────────────────── */
                <div className="p-4 space-y-4">
                  {/* Clickable preview → native color picker */}
                  <div className="relative group">
                    <div
                      className="w-full h-9 rounded-[10px] cursor-pointer"
                      style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.12)' }}
                      onClick={() => colorInputRef.current?.click()}
                      title="Click to pick custom color"
                    />
                    <div
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-[10px]"
                      style={{ background: 'rgba(0,0,0,0.35)' }}
                    >
                      <span className="text-[10px] text-white font-medium">Custom color</span>
                    </div>
                    <input
                      ref={colorInputRef}
                      type="color"
                      className="absolute opacity-0 w-0 h-0 pointer-events-none"
                      onChange={(e) => handleCustomColor(e.target.value)}
                    />
                  </div>

                  {/* Preset swatches */}
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>
                      Presets
                    </span>
                    <div className="grid grid-cols-7 gap-1.5 w-full">
                      {PRESET_COLORS.map(({ hex, label }) => (
                        <button
                          key={hex}
                          title={label}
                          onClick={() => handleCustomColor(hex)}
                          className="aspect-square rounded-lg transition-transform hover:scale-110 active:scale-95"
                          style={{
                            background: hex,
                            boxShadow: '0 0 0 0.5px rgba(255,255,255,0.15), 0 1px 4px rgba(0,0,0,0.3)',
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Hue slider */}
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>Hue</span>
                    <GradientSlider
                      value={hue} min={0} max={360}
                      trackGradient={`linear-gradient(to right, ${hueTrack})`}
                      thumbColor={currentHue}
                      onChange={handleHueChange}
                      onRelease={flushUpdate}
                    />
                  </div>

                  {/* Tint slider */}
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>Tint</span>
                    <GradientSlider
                      value={tint} min={0} max={100}
                      trackGradient={tintTrack}
                      thumbColor={currentTint}
                      onChange={handleTintChange}
                      onRelease={flushUpdate}
                    />
                  </div>

                  {/* Brightness slider */}
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>Brightness</span>
                    <GradientSlider
                      value={brightness} min={0} max={100}
                      trackGradient={brightTrack}
                      thumbColor={currentBright}
                      onChange={handleBrightnessChange}
                      onRelease={flushUpdate}
                    />
                  </div>
                </div>
              ) : (
                /* ── GRADIENT mode ──────────────────────────────────── */
                <div className="p-4 space-y-3">
                  {/* Gradient preview — full width */}
                  <div
                    className="w-full h-9 rounded-[10px]"
                    style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.12)' }}
                  />

                  {/* Fixed 2 stops — each fills full width */}
                  <div className="space-y-2">
                    {[0, 1].map((i) => {
                      const stop = localStops[i] ?? { offset: i, color: i === 0 ? '#2a2a2e' : '#1a1a1e' };
                      return (
                        <div key={i} className="flex items-center gap-2 w-full">
                          {/* Color swatch */}
                          <div className="relative w-7 h-7 shrink-0 rounded-[6px] overflow-hidden" style={{ boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.15)' }}>
                            <input
                              type="color"
                              value={stop.color}
                              onChange={(e) => handleStopChange(i, e.target.value)}
                              className="absolute -inset-2 w-12 h-10 cursor-pointer border-0 p-0"
                            />
                            <div className="absolute inset-0 pointer-events-none" style={{ background: stop.color }} />
                          </div>
                          {/* Hex input — fills remaining space */}
                          <input
                            type="text"
                            value={stop.color.toUpperCase()}
                            onChange={(e) => handleStopChange(i, e.target.value)}
                            className="flex-1 min-w-0 text-xs bg-[#1a1a1c] border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[#ebebf5] focus:outline-none focus:border-[#0a84ff] font-mono"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
            <Sun
              size={16}
              weight="bold"
              className="flex-shrink-0 cursor-ew-resize"
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

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* ── Zoom ── */}
        <div ref={zoomMenuRef} className="relative">
          <button
            onClick={() => setShowZoomMenu(!showZoomMenu)}
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <MagnifyingGlass
              size={16}
              weight="bold"
              className="flex-shrink-0 cursor-ew-resize"
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

      {/* Right — Export */}
      <div className="flex items-center gap-2 min-w-[160px] justify-end">
        <div className="relative group flex items-center">
          <span
            className="w-2 h-2 rounded-full"
            title={webglPopoverText}
            style={{
              background:
                webgl2Status === 'active'
                  ? '#34C759'
                  : webgl2Status === 'error'
                    ? '#FF453A'
                    : 'rgba(255,255,255,0.20)',
              boxShadow:
                webgl2Status === 'active'
                  ? '0 0 6px rgba(52,199,89,0.8)'
                  : webgl2Status === 'error'
                    ? '0 0 6px rgba(255,69,58,0.7)'
                    : 'none',
            }}
          />
          <div
            className="absolute right-full mr-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{
              background: 'rgba(30,30,32,0.95)',
              border: '0.5px solid rgba(255,255,255,0.10)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.08)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              color: 'rgba(255,255,255,0.85)',
              fontSize: '10px',
              lineHeight: '14px',
              padding: '6px 8px',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
            }}
          >
            {webglPopoverText}
          </div>
        </div>
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
