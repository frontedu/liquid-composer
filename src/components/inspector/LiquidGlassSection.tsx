import React from 'react';
import { useStore } from '@nanostores/react';
import { $layers, updateLayerLiquidGlass } from '../../store/iconStore';
import { $selectedLayerId } from '../../store/uiStore';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';

const SHADOW_TYPES = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'chromatic', label: 'Chromatic' },
];

export function LiquidGlassSection() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);

  if (!layer) return null;

  const lg = layer.liquidGlass;
  const update = (partial: Parameters<typeof updateLayerLiquidGlass>[1]) =>
    updateLayerLiquidGlass(layer.id, partial);

  return (
    <div className="border-b border-[#2c2c2e] pb-3">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#ebebf5]">Liquid Glass</span>
          <Toggle checked={lg.enabled} onChange={(v) => update({ enabled: v })} size="sm" />
        </div>
        <span className="text-2xs text-[#636366] bg-[#2a2a2a] px-1.5 py-0.5 rounded">
          {lg.mode === 'all' ? 'All' : 'Individual'}
        </span>
      </div>

      {lg.enabled && (
        <div className="px-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#636366] w-16 shrink-0">Mode</span>
            <div className="flex items-center bg-[#2a2a2a] rounded border border-[#3a3a3c] overflow-hidden">
              {(['individual', 'all'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => update({ mode: m })}
                  className={`px-2.5 py-1 text-xs capitalize transition-colors
                    ${lg.mode === m ? 'bg-[#0a84ff] text-white' : 'text-[#636366] hover:text-[#ebebf5]'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-[#636366]">Specular</span>
            <Toggle checked={lg.specular} onChange={(v) => update({ specular: v })} />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Blur</span>
              <Toggle checked={lg.blur.enabled} onChange={(v) => update({ blur: { ...lg.blur, enabled: v } })} />
            </div>
            {lg.blur.enabled && (
              <Slider value={lg.blur.value} onChange={(v) => update({ blur: { ...lg.blur, value: v } })} min={0} max={100} />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Translucency</span>
              <Toggle checked={lg.translucency.enabled} onChange={(v) => update({ translucency: { ...lg.translucency, enabled: v } })} />
            </div>
            {lg.translucency.enabled && (
              <Slider value={lg.translucency.value} onChange={(v) => update({ translucency: { ...lg.translucency, value: v } })} min={0} max={100} />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Dark</span>
              <Toggle checked={lg.dark.enabled} onChange={(v) => update({ dark: { ...lg.dark, enabled: v } })} />
            </div>
            {lg.dark.enabled && (
              <Slider value={lg.dark.value} onChange={(v) => update({ dark: { ...lg.dark, value: v } })} min={0} max={100} />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Mono</span>
              <Toggle checked={lg.mono.enabled} onChange={(v) => update({ mono: { ...lg.mono, enabled: v } })} />
            </div>
            {lg.mono.enabled && (
              <Slider value={lg.mono.value} onChange={(v) => update({ mono: { ...lg.mono, value: v } })} min={0} max={100} />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Shadow</span>
              <Toggle checked={lg.shadow.enabled} onChange={(v) => update({ shadow: { ...lg.shadow, enabled: v } })} />
            </div>
            {lg.shadow.enabled && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#636366] w-16 shrink-0">Type</span>
                  <Select
                    value={lg.shadow.type}
                    onChange={(v) => update({ shadow: { ...lg.shadow, type: v as 'neutral' | 'chromatic' } })}
                    options={SHADOW_TYPES}
                    className="flex-1"
                  />
                </div>
                <Slider value={lg.shadow.value} onChange={(v) => update({ shadow: { ...lg.shadow, value: v } })} min={0} max={100} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
