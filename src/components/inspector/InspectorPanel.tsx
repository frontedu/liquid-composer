import React from 'react';
import { useStore } from '@nanostores/react';
import { $selectedLayerId } from '../../store/uiStore';
import { $layers, updateLayer } from '../../store/iconStore';
import { ColorSection } from './ColorSection';
import { LiquidGlassSection } from './LiquidGlassSection';
import { CompositionSection } from './CompositionSection';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';
import type { BlendMode } from '../../types/index';

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

function GroupColorSection() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);
  if (!layer) return null;

  const childCount = layers.filter((l) => l.parentId === layer.id).length;

  return (
    <div className="border-b border-white/[0.07] pb-5">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold text-[#ebebf5]">Group</span>
        <span className="text-2xs text-[#636366] bg-white/[0.07] px-1.5 py-0.5 rounded">
          {childCount} {childCount === 1 ? 'layer' : 'layers'}
        </span>
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
      </div>
    </div>
  );
}

export function InspectorPanel() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);

  return (
    <div className="w-[220px] bg-[#131316] border-l border-white/[0.07] flex flex-col overflow-y-auto">
      <div className="flex items-center border-b border-white/[0.07] px-3 h-9 shrink-0">
        <span className="text-xs font-medium text-[#ebebf5]">
          {layer ? layer.name : 'Inspector'}
        </span>
      </div>

      {!layer ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-[#636366] text-center">
            Select a layer to inspect its properties
          </p>
        </div>
      ) : (
        // key=layer.id forces full remount when switching layers → prevents stale local state
        <div key={layer.id} className="flex-1 overflow-y-auto">
          {layer.type === 'group' ? (
            <>
              <GroupColorSection />
              <CompositionSection />
            </>
          ) : (
            <>
              <ColorSection />
              <LiquidGlassSection />
              <CompositionSection />
            </>
          )}
        </div>
      )}
    </div>
  );
}
