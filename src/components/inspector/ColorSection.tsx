import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, updateLayer, updateLayerFill } from '../../store/iconStore';
import { $selectedLayerId } from '../../store/uiStore';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';
import type { BlendMode, FillConfig } from '../../types/index';

// Custom debounce hook for performance
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

const FILL_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
];

export function ColorSection() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);

  // Local state for performant colour dragging without choking the webGL store
  const [localSolidColor, setLocalSolidColor] = useState<string>('#ffffff');
  const debouncedSolidColor = useDebounce(localSolidColor, 10);

  const [localStops, setLocalStops] = useState<{offset: number, color: string}[]>([]);
  const debouncedStops = useDebounce(localStops, 10);

  // Track whether the debounced sync is from user input (not from initialization)
  const skipSolidSync = useRef(true);
  const skipStopsSync = useRef(true);

  // Initialize local state from layer BEFORE paint (prevents white flash on layer switch)
  useLayoutEffect(() => {
    if (layer?.fill.type === 'solid') {
      skipSolidSync.current = true;
      setLocalSolidColor(layer.fill.color ?? '#ffffff');
    } else if (layer?.fill.type === 'gradient' && 'stops' in layer.fill) {
      skipStopsSync.current = true;
      setLocalStops(layer.fill.stops as typeof localStops);
    }
  }, [layer?.id, layer?.fill.type]);

  // Sync debounced solid color to store (skip on initialization)
  useEffect(() => {
    if (!layer) return;
    if (skipSolidSync.current) { skipSolidSync.current = false; return; }
    if (layer.fill.type === 'solid' && debouncedSolidColor !== layer.fill.color) {
      updateLayerFill(layer.id, { type: 'solid', color: debouncedSolidColor });
    }
  }, [debouncedSolidColor]);

  // Sync debounced gradient stops to store (skip on initialization)
  useEffect(() => {
    if (!layer || layer.fill.type !== 'gradient' || !('stops' in layer.fill)) return;
    if (skipStopsSync.current) { skipStopsSync.current = false; return; }
    if (debouncedStops.length > 0) {
      updateLayerFill(layer.id, { type: 'gradient', stops: debouncedStops, angle: layer.fill.angle });
    }
  }, [debouncedStops]);

  if (!layer) return null;

  const fill = layer.fill;

  return (
    <div className="border-b border-[#2c2c2e] pb-5">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold text-[#ebebf5]">Color</span>
        <span className="text-2xs text-[#636366] bg-[#2a2a2a] px-1.5 py-0.5 rounded">All</span>
      </div>

      <div className="px-3 space-y-3">
        <Slider
          label="Opacity"
          value={layer.opacity}
          onChange={(v) => updateLayer(layer.id, { opacity: v })}
          min={0}
          max={100}
        />

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#636366] w-16 shrink-0">Blend</span>
          <Select
            value={layer.blendMode}
            onChange={(v) => updateLayer(layer.id, { blendMode: v as BlendMode })}
            options={BLEND_MODES}
            className="flex-1"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#636366] w-16 shrink-0">Fill</span>
            <Select
              value={fill.type}
              onChange={(v) => {
                if (v === 'none') updateLayerFill(layer.id, { type: 'none' });
                else if (v === 'solid') {
                  setLocalSolidColor('#ffffff');
                  updateLayerFill(layer.id, { type: 'solid', color: '#ffffff' });
                }
                else {
                  const initialStops = [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }];
                  setLocalStops(initialStops);
                  updateLayerFill(layer.id, {
                    type: 'gradient',
                    stops: initialStops,
                    angle: 90,
                  });
                }
              }}
              options={FILL_TYPES}
              className="flex-1"
            />
          </div>

          {fill.type === 'solid' && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-[#636366] w-16 shrink-0">Color</span>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <input
                  type="color"
                  value={localSolidColor}
                  onChange={(e) => setLocalSolidColor(e.target.value)}
                  className="w-7 h-6 shrink-0 rounded cursor-pointer bg-transparent border-0"
                />
                <input
                  type="text"
                  value={localSolidColor}
                  onChange={(e) => setLocalSolidColor(e.target.value)}
                  className="min-w-0 flex-1 text-xs bg-[#2a2a2a] border border-[#3a3a3c] rounded-md px-1.5 py-0.5 text-[#ebebf5] focus:outline-none focus:border-[#0a84ff]"
                />
              </div>
            </div>
          )}

          {fill.type === 'gradient' && 'stops' in fill && (
            <div className="space-y-1.5">
              {/* Gradient preview */}
              <div
                className="w-full h-4 rounded-md"
                style={{ background: `linear-gradient(90deg, ${(localStops[0]?.color ?? '#fff')}, ${(localStops[1]?.color ?? '#000')})` }}
              />
              {/* Fixed 2 color stops */}
              {[0, 1].map((i) => {
                const stop = localStops[i] ?? { offset: i, color: i === 0 ? '#ffffff' : '#000000' };
                return (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <input
                      type="color"
                      value={stop.color}
                      onChange={(e) => {
                        const newStops = [...localStops];
                        newStops[i] = { ...newStops[i], color: e.target.value };
                        setLocalStops(newStops);
                      }}
                      className="w-7 h-6 shrink-0 rounded cursor-pointer bg-transparent border-0"
                    />
                    <input
                      type="text"
                      value={stop.color}
                      onChange={(e) => {
                        const newStops = [...localStops];
                        newStops[i] = { ...newStops[i], color: e.target.value };
                        setLocalStops(newStops);
                      }}
                      className="flex-1 min-w-0 text-xs bg-[#2a2a2a] border border-[#3a3a3c] rounded-md px-1.5 py-0.5 text-[#ebebf5] focus:outline-none focus:border-[#0a84ff]"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
