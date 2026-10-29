import { useStore } from '@nanostores/react';
import { CaretDown, ArrowCounterClockwise, SlidersHorizontal } from '@phosphor-icons/react';
import { $layers, updateLayerLiquidGlass, updateAllLayersLiquidGlass } from '../../store/iconStore';
import { $selectedLayerId, $showAdvancedGlass } from '../../store/uiStore';
import { DEFAULT_EFFECTS } from '../../engine/IconRenderer';
import { MATERIAL } from '../../engine/glassContract';
import type { LayerEffects } from '../../types/index';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';

type Adjustment = { enabled: boolean; value: number };

const SPECULAR_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'inside', label: 'Inside' },
  { value: 'outside', label: 'Outside' },
];

type EffectControl = { key: keyof LayerEffects; label: string };
const EFFECT_GROUPS: { title: string; description: string; controls: EffectControl[] }[] = [
  { title: 'Highlights', description: 'Light and dark edges along the glass.', controls: [
    { key: 'keyHighlight', label: 'Top' },
    { key: 'fillHighlight', label: 'Bottom' },
    { key: 'darklight', label: 'Edge definition' },
  ] },
  { title: 'Surface', description: 'Softness within the glass.', controls: [
    { key: 'frostiness', label: 'Frostiness' },
  ] },
];
const ADVANCED_RESET: Partial<LayerEffects> = { keyHighlight: 100, fillHighlight: 100, darklight: 100, frostiness: 0 };

const toHeight = (bevel: number) => Math.round(Math.min(100, Math.max(0, (bevel * 1024 / 100 - MATERIAL.heightMin) / MATERIAL.heightRange * 100)) * 10) / 10;
const toBevel = (height: number) => (MATERIAL.heightMin + MATERIAL.heightRange * height / 100) / 1024 * 100;

function AdjustmentRow({ label, adjustment, onChange, max = 100, showSlider = true }: { label: string; adjustment: Adjustment; onChange: (a: Adjustment) => void; max?: number; showSlider?: boolean }) {
  return (
    <div className="glass-setting-row">
      <div className="flex items-center justify-between gap-3 min-h-8">
        <span className="text-xs text-[#d1d1d6]">{label}</span>
        <Toggle ariaLabel={label} checked={adjustment.enabled} onChange={(v) => onChange({ ...adjustment, enabled: v })} />
      </div>
      {adjustment.enabled && showSlider && (
        <Slider ariaLabel={label} layout="stacked" value={adjustment.value} onChange={(v) => onChange({ ...adjustment, value: v })} min={0} max={max} />
      )}
    </div>
  );
}

export function LiquidGlassSection() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const showAdvanced = useStore($showAdvancedGlass);
  const layer = layers.find((l) => l.id === selectedId);

  if (!layer) return null;

  const lg = layer.liquidGlass;
  const fx = { ...DEFAULT_EFFECTS, ...lg.effects };
  const update = (partial: Parameters<typeof updateLayerLiquidGlass>[1]) =>
    lg.mode === 'all'
      ? updateAllLayersLiquidGlass(partial)
      : updateLayerLiquidGlass(layer.id, partial);
  const setEffect = (key: keyof LayerEffects, value: number) => update({ effects: { [key]: value } });
  const refractionOn = lg.refraction?.enabled !== false;
  const gradient = lg.translucencyGradient ?? { enabled: false, angle: 90, start: 0, end: 100, startOpacity: 100, endOpacity: 0 };
  const targets = lg.mode === 'all' ? layers : [layer];
  const canReset = targets.some(({ liquidGlass: glass }) => {
    const effects = { ...DEFAULT_EFFECTS, ...glass.effects };
    return (glass.aberration ?? 0) !== 0 || (glass.specularIntensity ?? 100) !== 100 ||
      Object.entries(ADVANCED_RESET).some(([key, value]) => effects[key as keyof LayerEffects] !== value);
  });

  return (
    <div className="glass-settings border-b border-white/[0.07] pb-5">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#ebebf5]">Liquid Glass</span>
          <Toggle ariaLabel="Liquid Glass" checked={lg.enabled} onChange={(v) => update({ enabled: v })} />
        </div>
        <span className="text-2xs text-[#636366] bg-white/[0.07] px-1.5 py-0.5 rounded">
          {lg.mode === 'all' ? 'All layers' : 'This layer'}
        </span>
      </div>

      {lg.enabled && (
        <div className="px-3 space-y-3">
          <div className="space-y-2">
            <span className="glass-setting-caption">Apply changes to</span>
            <div className="glass-segments" role="group" aria-label="Apply glass changes to">
              {(['individual', 'all'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={lg.mode === m}
                  onClick={() => update({ mode: m })}
                >
                  {m === 'individual' ? 'This layer' : 'All layers'}
                </button>
              ))}
            </div>
          </div>

          <div className="glass-setting-group">
            <div className="glass-setting-row flex items-center justify-between gap-3 min-h-9">
              <span className="text-xs text-[#d1d1d6]">Specular</span>
              <Select
                ariaLabel="Specular"
                className="w-28"
                value={lg.specular === false ? 'off' : lg.specular === true ? 'automatic' : lg.specular}
                options={SPECULAR_OPTIONS}
                onChange={(v) => update({ specular: v === 'off' ? false : v === 'automatic' ? true : v as 'inside' | 'outside' })}
              />
            </div>
            <div className="glass-setting-row">
              <div className="flex items-center justify-between gap-3 min-h-8">
                <span className="text-xs text-[#d1d1d6]">Refraction</span>
                <Toggle ariaLabel="Refraction" checked={refractionOn} onChange={(v) => update({ refraction: { enabled: v } })} />
              </div>
              {refractionOn && (
                <>
                  <Slider layout="stacked" label="Strength" value={fx.refraction} onChange={(v) => setEffect('refraction', v)} min={-100} max={100} />
                  <Slider layout="stacked" label="Height" value={toHeight(fx.bevel)} onChange={(v) => setEffect('bevel', toBevel(v))} min={0} max={100} />
                </>
              )}
            </div>
            <AdjustmentRow label="Blur" adjustment={lg.blur} onChange={(a) => update({ blur: a })} />
            <AdjustmentRow label="Translucency" adjustment={lg.translucency} onChange={(a) => update({ translucency: a, ...(a.enabled ? {} : { translucencyGradient: { ...gradient, enabled: false } }) })} showSlider={!gradient.enabled} />
            <div className="glass-setting-row">
              <div className="flex items-center justify-between gap-3 min-h-8">
                <span className="text-xs text-[#d1d1d6]">Gradient translucency</span>
                <Toggle ariaLabel="Gradient translucency" checked={gradient.enabled} onChange={(enabled) => update({ translucencyGradient: { ...gradient, enabled } })} />
              </div>
              {gradient.enabled && (
                <div className="space-y-2 pt-2">
                  <Slider layout="stacked" label={`Angle · ${gradient.angle}°`} value={gradient.angle} onChange={(angle) => update({ translucencyGradient: { ...gradient, angle } })} min={0} max={360} />
                  <Slider layout="stacked" label={`Start position · ${gradient.start}%`} value={gradient.start} onChange={(start) => update({ translucencyGradient: { ...gradient, start, end: Math.max(start + 1, gradient.end) } })} min={0} max={99} />
                  <Slider layout="stacked" label={`End position · ${gradient.end}%`} value={gradient.end} onChange={(end) => update({ translucencyGradient: { ...gradient, end } })} min={gradient.start + 1} max={100} />
                  <Slider layout="stacked" label={`Start opacity · ${gradient.startOpacity}%`} value={gradient.startOpacity} onChange={(startOpacity) => update({ translucencyGradient: { ...gradient, startOpacity } })} min={0} max={100} />
                  <Slider layout="stacked" label={`End opacity · ${gradient.endOpacity}%`} value={gradient.endOpacity} onChange={(endOpacity) => update({ translucencyGradient: { ...gradient, endOpacity } })} min={0} max={100} />
                  <p className="text-[10px] leading-4 text-[#8e8e93]">Opacity controls how visible the artwork is at each end of the gradient.</p>
                </div>
              )}
            </div>
            <AdjustmentRow label="Shadow" adjustment={lg.shadow} onChange={(a) => update({ shadow: { ...lg.shadow, ...a } })} max={200} />
          </div>

          <div className="glass-advanced-header">
            <button
              type="button"
              onClick={() => $showAdvancedGlass.set(!showAdvanced)}
              aria-expanded={showAdvanced}
              aria-controls="advanced-glass-controls"
              className="flex flex-1 items-center gap-2 min-h-9 text-xs font-semibold text-[#f2f2f7]"
            >
              <SlidersHorizontal size={16} className="text-[#64a8ff]" aria-hidden="true" />
              Advanced
              <CaretDown size={10} weight="bold" aria-hidden="true" className={`ml-auto text-[#98989f] ${showAdvanced ? '' : '-rotate-90'}`} />
            </button>
            {showAdvanced && (
              <button
                type="button"
                onClick={() => update({ effects: ADVANCED_RESET, aberration: 0, specularIntensity: 100 })}
                disabled={!canReset}
                aria-label="Reset advanced glass settings"
                title="Reset advanced settings"
                className="glass-reset"
              >
                <ArrowCounterClockwise size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {showAdvanced && (
            <div id="advanced-glass-controls" className="space-y-2">
              <details className="glass-setting-group" open>
                <summary className="glass-group-summary">Lens<CaretDown size={11} aria-hidden="true" /></summary>
                <div className="glass-group-controls">
                  <p className="glass-setting-caption">Color split where the glass bends the layers below.</p>
                  <Slider layout="stacked" label="Dispersion" disabled={!refractionOn} value={lg.aberration ?? 0} onChange={(v) => update({ aberration: v })} min={0} max={100} />
                </div>
              </details>

              {EFFECT_GROUPS.map((group) => (
                <details key={group.title} className="glass-setting-group">
                  <summary className="glass-group-summary">{group.title}<CaretDown size={11} aria-hidden="true" /></summary>
                  <div className="glass-group-controls">
                    <p className="glass-setting-caption">{group.description}</p>
                    {group.title === 'Highlights' && (
                      <Slider layout="stacked" label="Light intensity" disabled={!lg.specular} value={lg.specularIntensity ?? 100} onChange={(v) => update({ specularIntensity: v })} />
                    )}
                    {group.controls.map((c) => (
                      <Slider
                        key={c.key}
                        layout="stacked"
                        label={c.label}
                        ariaLabel={`${group.title}: ${c.label}`}
                        disabled={group.title === 'Highlights' && !lg.specular}
                        value={fx[c.key]}
                        onChange={(v) => setEffect(c.key, v)}
                        min={0}
                        max={100}
                      />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
