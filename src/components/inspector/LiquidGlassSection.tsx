import { useStore } from '@nanostores/react';
import { CaretDown, ArrowCounterClockwise, SlidersHorizontal } from '@phosphor-icons/react';
import { $layers, updateLayerLiquidGlass, updateAllLayersLiquidGlass } from '../../store/iconStore';
import { $selectedLayerId, $showAdvancedGlass } from '../../store/uiStore';
import { DEFAULT_EFFECTS } from '../../engine/IconRenderer';
import type { LayerEffects } from '../../types/index';
import { Toggle } from '../ui/Toggle';
import { Slider } from '../ui/Slider';

type Adjustment = { enabled: boolean; value: number };

type EffectControl = { key: keyof LayerEffects; label: string; max?: number; step?: number };
const EFFECT_GROUPS: { title: string; description: string; controls: EffectControl[] }[] = [
  { title: 'Reflections', description: 'Light along the glass surface.', controls: [
    { key: 'specularEdge', label: 'Edge highlight' },
    { key: 'rimIntensity', label: 'Fresnel rim' },
    { key: 'envReflection', label: 'Environment' },
    { key: 'innerGlow', label: 'Inner glow' },
    { key: 'ambientRim', label: 'Ambient rim' },
  ] },
  { title: 'Surface', description: 'Softness and light within the glass.', controls: [
    { key: 'frostiness', label: 'Frostiness' },
    { key: 'aoDarken', label: 'Ambient light' },
    { key: 'domeIntensity', label: 'Dome light' },
    { key: 'domeRadius', label: 'Radius' },
  ] },
  { title: 'Inner rim', description: 'A fine highlight inside the silhouette.', controls: [
    { key: 'innerRimWidth', label: 'Width', max: 6, step: 0.1 },
    { key: 'innerRimLitAlpha', label: 'Light side' },
    { key: 'innerRimShadowAlpha', label: 'Shadow side' },
  ] },
  { title: 'Inner shadow', description: 'Depth along the shaded edge.', controls: [
    { key: 'innerShadowWidth', label: 'Width', max: 5, step: 0.1 },
    { key: 'innerShadowAlpha', label: 'Opacity' },
  ] },
  { title: 'Outer border', description: 'Definition around the outer edge.', controls: [
    { key: 'outerBorderWidth', label: 'Width', max: 2, step: 0.05 },
    { key: 'outerBorderAlpha', label: 'Opacity' },
  ] },
];

function AdjustmentRow({ label, adjustment, onChange }: { label: string; adjustment: Adjustment; onChange: (a: Adjustment) => void }) {
  return (
    <div className="glass-setting-row">
      <div className="flex items-center justify-between gap-3 min-h-8">
        <span className="text-xs text-[#d1d1d6]">{label}</span>
        <Toggle ariaLabel={label} checked={adjustment.enabled} onChange={(v) => onChange({ ...adjustment, enabled: v })} />
      </div>
      {adjustment.enabled && (
        <Slider ariaLabel={label} layout="stacked" value={adjustment.value} onChange={(v) => onChange({ ...adjustment, value: v })} min={0} max={100} />
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
  const targets = lg.mode === 'all' ? layers : [layer];
  const canReset = targets.some(({ liquidGlass: glass }) =>
    (glass.aberration ?? 20) !== 20 || (glass.specularIntensity ?? 100) !== 100 ||
    Object.entries(glass.effects ?? {}).some(([key, value]) => value !== DEFAULT_EFFECTS[key as keyof LayerEffects])
  );

  return (
    <div className="glass-settings border-b border-white/[0.07] pb-5">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#ebebf5]">Liquid Glass</span>
          <Toggle ariaLabel="Liquid Glass" checked={lg.enabled} onChange={(v) => update({ enabled: v })} />
        </div>
        <span className="text-2xs text-[#636366] bg-white/[0.07] px-1.5 py-0.5 rounded">
          {lg.mode === 'all' ? 'All' : 'Individual'}
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
              <Toggle ariaLabel="Specular" checked={lg.specular} onChange={(v) => update({ specular: v })} />
            </div>
            <AdjustmentRow label="Translucency" adjustment={lg.translucency} onChange={(a) => update({ translucency: a })} />
            <AdjustmentRow label="Shadow" adjustment={lg.shadow} onChange={(a) => update({ shadow: { ...lg.shadow, ...a } })} />
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
                onClick={() => update({ effects: undefined, aberration: 20, specularIntensity: 100 })}
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
                  <p className="glass-setting-caption">Shape how the glass bends the layers below.</p>
                  <Slider layout="stacked" label="Depth" value={fx.bevel} onChange={(v) => setEffect('bevel', v)} min={0} max={20} step={0.5} />
                  <Slider layout="stacked" label="Refraction" value={fx.refraction} onChange={(v) => setEffect('refraction', v)} min={0} max={100} />
                  <Slider layout="stacked" label="Dispersion" value={lg.aberration ?? 20} onChange={(v) => update({ aberration: v })} min={0} max={100} />
                </div>
              </details>

              {EFFECT_GROUPS.map((group) => (
                <details key={group.title} className="glass-setting-group">
                  <summary className="glass-group-summary">{group.title}<CaretDown size={11} aria-hidden="true" /></summary>
                  <div className="glass-group-controls">
                    <p className="glass-setting-caption">{group.description}</p>
                    {group.title === 'Reflections' && (
                      <Slider layout="stacked" label="Light intensity" disabled={!lg.specular} value={lg.specularIntensity ?? 100} onChange={(v) => update({ specularIntensity: v })} />
                    )}
                    {group.controls.map((c) => (
                      <Slider
                        key={c.key}
                        layout="stacked"
                        label={c.label}
                        ariaLabel={`${group.title}: ${c.label}`}
                        value={fx[c.key]}
                        onChange={(v) => setEffect(c.key, v)}
                        min={0}
                        max={c.max ?? 100}
                        step={c.step ?? 1}
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
