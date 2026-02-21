import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { $iconName, $iconModified, updateBackground, $background, setIconName, bgColorsFromHueTint } from '../../store/iconStore';
import { $lightAngle, $zoom, setLightAngle, setZoom, ZOOM_LEVELS } from '../../store/uiStore';

// ─── Gradient slider ──────────────────────────────────────────────────────

function GradientSlider({
  value, min, max, trackGradient, thumbColor, onChange,
}: {
  value: number;
  min: number;
  max: number;
  trackGradient: string;
  thumbColor: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative h-5 flex items-center">
      <div
        className="absolute left-0 right-0 h-[10px] rounded-full"
        style={{
          background: trackGradient,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
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

// ─── Pill button (toolbar controls) ──────────────────────────────────────

function PillButton({
  onClick,
  children,
  active,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-[8px] text-[11px] font-medium transition-all duration-150"
      style={
        active
          ? {
              background: 'rgba(255,255,255,0.14)',
              color: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.20)',
            }
          : {
              background: 'rgba(255,255,255,0.055)',
              color: 'rgba(255,255,255,0.55)',
              border: '0.5px solid rgba(255,255,255,0.09)',
            }
      }
    >
      {children}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export function TopToolbar() {
  const name     = useStore($iconName);
  const modified = useStore($iconModified);
  const lightAngle = useStore($lightAngle);
  const zoom     = useStore($zoom);
  const bg       = useStore($background);

  const [showBgPicker,  setShowBgPicker]  = useState(false);
  const [showZoomMenu,  setShowZoomMenu]  = useState(false);
  const [editingAngle,  setEditingAngle]  = useState(false);
  const [angleInput,    setAngleInput]    = useState(String(lightAngle));
  const [editingName,   setEditingName]   = useState(false);
  const [nameInput,     setNameInput]     = useState(name);

  const hue  = bg.hue  ?? 220;
  const tint = bg.tint ?? 20;

  const commitName    = () => { setIconName(nameInput); setEditingName(false); };
  const cancelName    = () => setEditingName(false);

  const handleAngleSubmit = () => {
    const v = parseInt(angleInput, 10);
    if (!isNaN(v)) setLightAngle(Math.min(360, Math.max(-360, v)));
    setEditingAngle(false);
  };

  const handleHueChange  = (h: number) =>
    updateBackground({ type: 'gradient', hue: h,    tint, colors: bgColorsFromHueTint(h,    tint), angle: 135 });
  const handleTintChange = (t: number) =>
    updateBackground({ type: 'gradient', hue,  tint: t, colors: bgColorsFromHueTint(hue, t),    angle: 135 });

  const hueTrack  = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360]
    .map((h) => `hsl(${h},100%,50%)`).join(', ');
  const tintTrack    = `linear-gradient(to right, hsl(${hue},85%,50%), hsl(${hue},28%,88%))`;
  const currentHue   = `hsl(${hue},100%,50%)`;
  const currentTint  = `hsl(${hue},${Math.round(85 - tint * 0.55)}%,${Math.round(50 + tint * 0.38)}%)`;
  const bgPreview    = `linear-gradient(135deg, ${bgColorsFromHueTint(hue, tint).join(', ')})`;

  return (
    <div
      className="flex items-center h-11 px-3 select-none"
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
            onKeyDown={(e) => {
              if (e.key === 'Enter')  commitName();
              if (e.key === 'Escape') cancelName();
            }}
            className="text-[11px] font-medium rounded-[6px] px-2 py-0.5 focus:outline-none w-32"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '0.5px solid rgba(10,132,255,0.8)',
              color: '#ffffff',
            }}
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
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.30)' }}
            title="Unsaved changes"
          />
        )}
      </div>

      {/* Center — tools */}
      <div className="flex-1 flex items-center justify-center gap-2">

        {/* Background picker */}
        <div className="relative">
          <button
            onClick={() => setShowBgPicker(!showBgPicker)}
            className="flex items-center gap-2 px-2.5 py-[5px] rounded-[8px] transition-all duration-150"
            style={{
              background: 'rgba(255,255,255,0.055)',
              border: '0.5px solid rgba(255,255,255,0.09)',
            }}
            title="Background color"
          >
            <div
              className="w-[18px] h-[18px] rounded-[5px] flex-shrink-0"
              style={{
                background: bgPreview,
                boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.15)',
              }}
            />
            <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.50)' }}>
              Background
            </span>
            <svg
              className="w-2.5 h-2.5 flex-shrink-0"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
              style={{ color: 'rgba(255,255,255,0.30)' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showBgPicker && (
            <div
              className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 p-4 rounded-[16px] w-64 shadow-2xl"
              style={{
                background: 'rgba(30,30,32,0.92)',
                backdropFilter: 'blur(40px) saturate(200%)',
                WebkitBackdropFilter: 'blur(40px) saturate(200%)',
                border: '0.5px solid rgba(255,255,255,0.10)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 0.5px 0 rgba(255,255,255,0.08)',
              }}
            >
              <div
                className="w-full h-10 rounded-[10px] mb-4"
                style={{
                  background: bgPreview,
                  boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.12)',
                }}
              />
              <div className="mb-4">
                <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block"
                  style={{ color: 'rgba(255,255,255,0.30)' }}>Hue</span>
                <GradientSlider
                  value={hue} min={0} max={360}
                  trackGradient={`linear-gradient(to right, ${hueTrack})`}
                  thumbColor={currentHue}
                  onChange={handleHueChange}
                />
              </div>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block"
                  style={{ color: 'rgba(255,255,255,0.30)' }}>Tint</span>
                <GradientSlider
                  value={tint} min={0} max={100}
                  trackGradient={tintTrack}
                  thumbColor={currentTint}
                  onChange={handleTintChange}
                />
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* Light angle */}
        <div className="flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 flex-shrink-0"
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
            style={{ color: 'rgba(255,255,255,0.30)' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 3v1m0 16v1m8.66-13l-.87.5M4.21 16.5l-.87.5M20.66 16.5l-.87-.5M4.21 7.5l-.87-.5M21 12h-1M4 12H3" />
          </svg>
          {editingAngle ? (
            <input
              autoFocus
              type="number"
              value={angleInput}
              onChange={(e) => setAngleInput(e.target.value)}
              onBlur={handleAngleSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleAngleSubmit()}
              className="w-14 text-[11px] text-center focus:outline-none rounded-[6px] px-1.5 py-0.5"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '0.5px solid rgba(10,132,255,0.8)',
                color: '#ffffff',
              }}
            />
          ) : (
            <button
              onClick={() => { setEditingAngle(true); setAngleInput(String(lightAngle)); }}
              className="text-[11px] font-medium tabular-nums"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              {lightAngle}°
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.08)' }} />

        {/* Zoom */}
        <div className="relative">
          <button
            onClick={() => setShowZoomMenu(!showZoomMenu)}
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <svg
              className="w-3 h-3 flex-shrink-0"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
              style={{ color: 'rgba(255,255,255,0.30)' }}
            >
              <circle cx="11" cy="11" r="7" strokeWidth="1.8" />
              <path strokeLinecap="round" strokeWidth="1.8" d="M21 21l-4-4" />
            </svg>
            <span className="tabular-nums">{zoom}%</span>
            <svg
              className="w-2 h-2"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
              style={{ color: 'rgba(255,255,255,0.25)' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showZoomMenu && (
            <div
              className="absolute top-full right-0 mt-2 z-50 py-1.5 rounded-[12px] shadow-xl min-w-[90px]"
              style={{
                background: 'rgba(30,30,32,0.92)',
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
                  style={{
                    color: zoom === z ? '#0a84ff' : 'rgba(255,255,255,0.65)',
                  }}
                  onMouseEnter={(e) =>
                    ((e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)')
                  }
                  onMouseLeave={(e) =>
                    ((e.target as HTMLElement).style.background = 'transparent')
                  }
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

      {/* Backdrop to close dropdowns */}
      {(showBgPicker || showZoomMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowBgPicker(false); setShowZoomMenu(false); }}
        />
      )}
    </div>
  );
}
