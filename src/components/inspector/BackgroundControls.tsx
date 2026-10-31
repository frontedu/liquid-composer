import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { $background, updateBackground, bgColorsFromHueTint } from '../../store/iconStore';
import { ColorPicker } from '../ui/ColorPicker';

function hsvToHex(h: number, s: number, v: number): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

function hexToHSV(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const d   = max - Math.min(r, g, b);
  let h = 0;
  if (d && max === r)      h = (g - b) / d + (g < b ? 6 : 0);
  else if (d && max === g) h = (b - r) / d + 2;
  else if (d)              h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: max ? d / max : 0, v: max };
}

const PRESET_COLORS = [
  // Row 1 — HIG system colors, default light (7)
  { hex: '#FF383C', label: 'Red'    },
  { hex: '#FF8D28', label: 'Orange' },
  { hex: '#FFCC00', label: 'Yellow' },
  { hex: '#34C759', label: 'Green'  },
  { hex: '#00C8B3', label: 'Mint'   },
  { hex: '#00C3D0', label: 'Teal'   },
  { hex: '#00C0E8', label: 'Cyan'   },
  // Row 2 — HIG system colors + neutrals (7)
  { hex: '#0088FF', label: 'Blue'   },
  { hex: '#6155F5', label: 'Indigo' },
  { hex: '#CB30E0', label: 'Purple' },
  { hex: '#FF2D55', label: 'Pink'   },
  { hex: '#AC7F5E', label: 'Brown'  },
  { hex: '#F2F2F7', label: 'White'      },
  { hex: '#1C1C1E', label: 'Near Black' },
];

const GRADIENT_PRESETS = [
  { label: 'System Light', stops: [{ offset: 0, color: '#FFFFFF' }, { offset: 1, color: '#F5F5F5' }] },
  { label: 'System Dark', stops: [{ offset: 0, color: '#1F1F1F' }, { offset: 1, color: '#0F0F0F' }] },
];

function GradientSlider({
  value, min, max, trackGradient, thumbColor, onChange, onRelease, label,
}: {
  value: number; min: number; max: number;
  trackGradient: string; thumbColor: string; label: string;
  onChange: (v: number) => void;
  onRelease: () => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="relative h-8 flex items-center select-none rounded focus-within:outline-2 focus-within:outline-[#64a8ff]">
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
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onKeyUp={onRelease}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}

export function BackgroundControls() {
  const bg = useStore($background);
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

  const bgValuesRef = useRef({ type: storeBgType, stops: storeStops, hue: storeHue, tint: storeTint, brightness: storeBrightness });
  const rafRef      = useRef(0);

  const flushUpdate = useCallback(() => {
    if (!rafRef.current) return;
    clearTimeout(rafRef.current);
    rafRef.current = 0;
    const { type: t, stops: st, hue: h, tint: ti, brightness: br } = bgValuesRef.current;
    if (t === 'custom') {
      updateBackground({ type: 'gradient', bgType: 'custom', stops: st, angle: 90 });
    } else {
      updateBackground({ type: 'gradient', bgType: 'preset', hue: h, tint: ti, brightness: br, colors: bgColorsFromHueTint(h, ti, br), angle: 90 });
    }
  }, []);

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

  useLayoutEffect(() => {
    if (rafRef.current) { clearTimeout(rafRef.current); rafRef.current = 0; }
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
  }, [bg]);

  useEffect(() => () => {
    if (rafRef.current) flushUpdate();
  }, [flushUpdate]);

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
      const { h, s, v } = hexToHSV(hex);
      const newHue = s ? h : hue;
      const newTint = v ? Math.round((1 - s) * 100) : tint;
      const newBrightness = Math.round(v * 100);
      setLocalHue(newHue);
      setLocalTint(newTint);
      setLocalBrightness(newBrightness);
      bgValuesRef.current = { ...bgValuesRef.current, type: 'preset', hue: newHue, tint: newTint, brightness: newBrightness };
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
    newStops[index] = { ...newStops[index], offset: newStops[index]?.offset ?? index, color: hex };
    setLocalStops(newStops);
    if (!newStops.every((stop) => /^#[0-9a-f]{6}$/i.test(stop.color))) return;
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
    <div>
      <div className="flex border-b border-white/[0.06]">
        <button
          type="button"
          aria-pressed={localBgType === 'preset'}
          className={`flex-1 text-[11px] font-semibold py-2 transition-all ${
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
          type="button"
          aria-pressed={localBgType === 'custom'}
          className={`flex-1 text-[11px] font-semibold py-2 transition-all ${
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
        <div className="p-4 space-y-4">
          <ColorPicker
            label="Background color"
            value={hsvToHex(hue, 1 - tint / 100, brightness / 100)}
            onChange={handleCustomColor}
            className="relative group block w-full rounded-[8px]"
          >
            <span
              aria-hidden="true"
              className="block w-full h-8 rounded-[8px]"
              style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.12)' }}
            />
            <span
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-[10px]"
              style={{ background: 'rgba(0,0,0,0.35)' }}
            >
              <span className="text-[10px] text-white font-medium">Custom color</span>
            </span>
          </ColorPicker>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>
              Presets
            </span>
            <div className="grid grid-cols-7 gap-1.5 w-full">
              {PRESET_COLORS.map(({ hex, label }) => (
                <button
                  type="button"
                  key={hex}
                  title={label}
                  aria-label={label}
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

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>Hue</span>
            <GradientSlider
              label="Hue"
              value={hue} min={0} max={360}
              trackGradient={`linear-gradient(to right, ${hueTrack})`}
              thumbColor={currentHue}
              onChange={handleHueChange}
              onRelease={flushUpdate}
            />
          </div>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>Tint</span>
            <GradientSlider
              label="Tint"
              value={tint} min={0} max={100}
              trackGradient={tintTrack}
              thumbColor={currentTint}
              onChange={handleTintChange}
              onRelease={flushUpdate}
            />
          </div>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>Brightness</span>
            <GradientSlider
              label="Brightness"
              value={brightness} min={0} max={100}
              trackGradient={brightTrack}
              thumbColor={currentBright}
              onChange={handleBrightnessChange}
              onRelease={flushUpdate}
            />
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div
            className="w-full h-8 rounded-[8px]"
            style={{ background: bgPreview, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.12)' }}
          />

          <div className="space-y-2">
            {[0, 1].map((i) => {
              const stop = localStops[i] ?? { offset: i, color: i === 0 ? '#2a2a2e' : '#1a1a1e' };
              return (
                <div key={i} className="flex items-center gap-2 w-full">
                  <ColorPicker
                    label={`Gradient color ${i + 1}`}
                    value={/^#[0-9a-f]{6}$/i.test(stop.color) ? stop.color : bgValuesRef.current.stops[i]?.color ?? '#000000'}
                    onChange={(hex) => handleStopChange(i, hex)}
                  />
                  <input
                    type="text"
                    aria-label={`Gradient hex color ${i + 1}`}
                    value={stop.color.toUpperCase()}
                    onChange={(e) => handleStopChange(i, e.target.value)}
                    className="flex-1 min-w-0 text-xs bg-[#1a1a1c] border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[#ebebf5] focus:outline-hidden focus:border-[#0a84ff] font-mono"
                  />
                </div>
              );
            })}
          </div>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.28)' }}>
              Presets
            </span>
            <div className="grid grid-cols-7 gap-1.5 w-full">
              {GRADIENT_PRESETS.map(({ label, stops }) => (
                <button
                  type="button"
                  key={label}
                  title={label}
                  aria-label={label}
                  onClick={() => {
                    setLocalStops(stops);
                    bgValuesRef.current = { ...bgValuesRef.current, type: 'custom', stops };
                    scheduleUpdate();
                  }}
                  className="aspect-square rounded-lg transition-transform hover:scale-110 active:scale-95"
                  style={{
                    background: `linear-gradient(180deg, ${stops.map((s) => s.color).join(', ')})`,
                    boxShadow: '0 0 0 0.5px rgba(255,255,255,0.15), 0 1px 4px rgba(0,0,0,0.3)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
