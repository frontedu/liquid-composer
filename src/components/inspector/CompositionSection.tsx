import { useEffect, useState, useId } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, updateLayer } from '../../store/iconStore';
import { $selectedLayerId } from '../../store/uiStore';
import { NumberInput } from '../ui/NumberInput';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';

export function CompositionSection() {
  const nameId = useId();
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);
  const [nameValue, setNameValue] = useState(layer?.name ?? '');

  useEffect(() => {
    if (layer) setNameValue(layer.name);
  }, [layer?.name]);

  if (!layer) return null;

  const commitName = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== layer.name) updateLayer(layer.id, { name: trimmed });
    else setNameValue(layer.name);
  };

  const { layout, visible } = layer;
  const isGroup = layer.type === 'group';

  return (
    <div className="border-b border-white/[0.07] pb-5">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold text-[#ebebf5]">Composition</span>
        <span className="text-2xs text-[#636366] bg-white/[0.07] px-1.5 py-0.5 rounded">All</span>
      </div>

      <div className="px-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#636366]">Visible</span>
          <Toggle ariaLabel="Layer visibility" checked={visible} onChange={(v) => updateLayer(layer.id, { visible: v })} />
        </div>

        <div className="space-y-2">
          <label htmlFor={nameId} className="text-xs text-[#a1a1aa]">Name</label>
          <input
            id={nameId}
            type="text"
            value={nameValue}
            title={layer.sourceFile}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setNameValue(layer.name);
              e.stopPropagation();
            }}
            className="w-full min-w-0 text-xs text-[#ebebf5] bg-white/[0.06] px-2 py-1 rounded border border-white/[0.08] focus:outline-hidden focus:border-[#0a84ff]"
          />
        </div>

        {!isGroup && (
          <>
            <div className="space-y-2">
              <span className="text-xs text-[#a1a1aa]">Position</span>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput ariaLabel="Position X" className="min-w-0" value={Math.round(layout.x * 10) / 10} onChange={(v) => updateLayer(layer.id, { layout: { ...layout, x: v } })} min={-512} max={512} step={0.1} unit="X" />
                <NumberInput ariaLabel="Position Y" className="min-w-0" value={Math.round(layout.y * 10) / 10} onChange={(v) => updateLayer(layer.id, { layout: { ...layout, y: v } })} min={-512} max={512} step={0.1} unit="Y" />
              </div>
            </div>

            <div className="space-y-1">
              <Slider
                layout="stacked"
                label="Scale"
                value={layout.scale}
                onChange={(v) => updateLayer(layer.id, { layout: { ...layout, scale: v } })}
                min={10}
                max={200}
                unit="%"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
