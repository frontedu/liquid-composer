import React, { useState, useEffect, useCallback } from 'react';
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

  // Sync local state when external layer selection or store changes (not caused by ourselves)
  useEffect(() => {
    if (layer?.fill.type === 'solid' && layer.fill.color !== debouncedSolidColor) {
      setLocalSolidColor(layer.fill.color ?? '#ffffff');
    } else if (layer?.fill.type === 'gradient' && 'stops' in layer.fill) {
      // Only sync if different to avoid loop
      const same = localStops.length === layer.fill.stops.length && 
                   localStops.every((s, i) => s.color === layer.fill.stops[i].color);
      if (!same) setLocalStops(layer.fill.stops);
    }
  }, [layer?.id, layer?.fill]);

  // Sync debounced values up to global store
  useEffect(() => {
    if (!layer) return;
    if (layer.fill.type === 'solid' && debouncedSolidColor !== layer.fill.color) {
      updateLayerFill(layer.id, { type: 'solid', color: debouncedSolidColor });
    }
  }, [debouncedSolidColor]);

  useEffect(() => {
    if (!layer || layer.fill.type !== 'gradient' || !('stops' in layer.fill)) return;
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
              <span className="text-xs text-[#636366]">Gradient Stops</span>
              {localStops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={stop.color}
                    onChange={(e) => {
                      const newStops = [...localStops];
                      newStops[i] = { ...newStops[i], color: e.target.value };
                      setLocalStops(newStops);
                    }}
                    className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                  />
                  <div
                    className="h-3 flex-1 rounded"
                    style={{ background: `linear-gradient(90deg, ${localStops.map((s) => s.color).join(', ')})` }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
