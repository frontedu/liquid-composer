import React from 'react';
import { useStore } from '@nanostores/react';
import { $layers, updateLayer } from '../../store/iconStore';
import { $selectedLayerId } from '../../store/uiStore';
import { NumberInput } from '../ui/NumberInput';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';

export function CompositionSection() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);

  if (!layer) return null;

  const { layout, visible } = layer;

  return (
    <div className="border-b border-[#2c2c2e] pb-3">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-[#ebebf5]">Composition</span>
        <span className="text-2xs text-[#636366] bg-[#2a2a2a] px-1.5 py-0.5 rounded">All</span>
      </div>

      <div className="px-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#636366]">Visible</span>
          <Toggle checked={visible} onChange={(v) => updateLayer(layer.id, { visible: v })} />
        </div>

        {layer.sourceFile && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#636366] w-12 shrink-0">Image</span>
            <span className="flex-1 text-xs text-[#ebebf5] truncate bg-[#2a2a2a] px-2 py-1 rounded border border-[#3a3a3c]">
              {layer.sourceFile}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#636366] w-12 shrink-0">Position</span>
          <div className="flex items-center gap-1.5">
            <NumberInput value={layout.x} onChange={(v) => updateLayer(layer.id, { layout: { ...layout, x: v } })} min={-512} max={512} unit="x" />
            <NumberInput value={layout.y} onChange={(v) => updateLayer(layer.id, { layout: { ...layout, y: v } })} min={-512} max={512} unit="y" />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#636366]">Scale</span>
            <span className="text-xs text-[#ebebf5]">{layout.scale}%</span>
          </div>
          <Slider
            value={layout.scale}
            onChange={(v) => updateLayer(layer.id, { layout: { ...layout, scale: v } })}
            min={10}
            max={200}
            unit="%"
          />
        </div>
      </div>
    </div>
  );
}
