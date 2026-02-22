import React from 'react';
import { useStore } from '@nanostores/react';
import { $layers, updateLayer, updateLayerFill } from '../../store/iconStore';
import { $selectedLayerId } from '../../store/uiStore';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';
import type { BlendMode, FillConfig } from '../../types/index';

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
                else if (v === 'solid') updateLayerFill(layer.id, { type: 'solid', color: '#ffffff' });
                else updateLayerFill(layer.id, {
                  type: 'gradient',
                  stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }],
                  angle: 90,
                });
              }}
              options={FILL_TYPES}
              className="flex-1"
            />
          </div>

          {fill.type === 'solid' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#636366] w-16 shrink-0">Color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={fill.color ?? '#ffffff'}
                  onChange={(e) => updateLayerFill(layer.id, { type: 'solid', color: e.target.value })}
                  className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                />
                <input
                  type="text"
                  value={fill.color ?? '#ffffff'}
                  onChange={(e) => updateLayerFill(layer.id, { type: 'solid', color: e.target.value })}
                  className="flex-1 text-xs bg-[#2a2a2a] border border-[#3a3a3c] rounded-md px-1.5 py-0.5 text-[#ebebf5] focus:outline-none focus:border-[#0a84ff]"
                />
              </div>
            </div>
          )}

          {fill.type === 'gradient' && 'stops' in fill && (
            <div className="space-y-1.5">
              <span className="text-xs text-[#636366]">Gradient Stops</span>
              {fill.stops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={stop.color}
                    onChange={(e) => {
                      const stops = [...fill.stops];
                      stops[i] = { ...stops[i], color: e.target.value };
                      updateLayerFill(layer.id, { type: 'gradient', stops, angle: fill.angle });
                    }}
                    className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                  />
                  <div
                    className="h-3 flex-1 rounded"
                    style={{ background: `linear-gradient(90deg, ${fill.stops.map((s) => s.color).join(', ')})` }}
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
