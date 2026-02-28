import React from 'react';
import { useStore } from '@nanostores/react';
import { $layers, updateLayerLiquidGlass, updateAllLayersLiquidGlass } from '../../store/iconStore';
import { $selectedLayerId } from '../../store/uiStore';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';

export function LiquidGlassSection() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);

  if (!layer) return null;

  const lg = layer.liquidGlass;
  const update = (partial: Parameters<typeof updateLayerLiquidGlass>[1]) =>
    lg.mode === 'all'
      ? updateAllLayersLiquidGlass(partial)
      : updateLayerLiquidGlass(layer.id, partial);

  return (
    <div className="border-b border-[#2c2c2e] pb-5">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#ebebf5]">Liquid Glass</span>
          <Toggle checked={lg.enabled} onChange={(v) => update({ enabled: v })} size="sm" />
        </div>
        <span className="text-2xs text-[#636366] bg-[#2a2a2a] px-1.5 py-0.5 rounded">
          {lg.mode === 'all' ? 'All' : 'Individual'}
        </span>
      </div>

      {lg.enabled && (
        <div className="px-3 space-y-4">
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Translucency</span>
              <Toggle checked={lg.translucency.enabled} onChange={(v) => update({ translucency: { ...lg.translucency, enabled: v } })} />
            </div>
            {lg.translucency.enabled && (
              <Slider value={lg.translucency.value} onChange={(v) => update({ translucency: { ...lg.translucency, value: v } })} min={0} max={100} />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#636366]">Shadow</span>
              <Toggle checked={lg.shadow.enabled} onChange={(v) => update({ shadow: { ...lg.shadow, enabled: v } })} />
            </div>
            {lg.shadow.enabled && (
              <Slider value={lg.shadow.value} onChange={(v) => update({ shadow: { ...lg.shadow, value: v } })} min={0} max={100} />
            )}
          </div>

        </div>
      )}
    </div>
  );
}
