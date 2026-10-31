import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { PencilSimple } from '@phosphor-icons/react';
import { $selectedLayerId, $appearanceMode, CANVAS_SELECTION_ID } from '../../store/uiStore';
import { $layers, updateLayer } from '../../store/iconStore';
import { ColorSection } from './ColorSection';
import { LiquidGlassSection } from './LiquidGlassSection';
import { CompositionSection } from './CompositionSection';
import { BackgroundControls } from './BackgroundControls';
import { Slider } from '../ui/Slider';
import { Select } from '../ui/Select';
import type { BlendMode, Layer } from '../../types/index';

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
  { value: 'plus-lighter', label: 'Plus Lighter' },
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
          layout="stacked"
          label="Opacity"
          value={layer.opacity}
          onChange={(v) => updateLayer(layer.id, { opacity: v })}
          min={0}
          max={100}
        />

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#636366] w-16 shrink-0">Blend</span>
          <Select
            ariaLabel="Group blend mode"
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

function LayerNameField({ layer }: { layer: Layer }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocusRef = useRef(false);
  const kind = layer.type === 'group' ? 'Group' : 'Layer';

  useEffect(() => {
    if (editing || !refocusRef.current) return;
    refocusRef.current = false;
    buttonRef.current?.focus();
  }, [editing]);

  const edit = () => {
    setValue(layer.name);
    setEditing(true);
  };

  const finish = (save: boolean, refocus: boolean) => {
    const trimmed = value.trim();
    if (save && trimmed && trimmed !== layer.name) updateLayer(layer.id, { name: trimmed });
    refocusRef.current = refocus;
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        aria-label={`${kind} name`}
        value={value}
        title={layer.sourceFile}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true, false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(true, true);
          }
          if (e.key === 'Escape') finish(false, true);
          e.stopPropagation();
        }}
        className="inspector-title-input"
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Rename ${kind.toLowerCase()} ${layer.name}`}
      title="Rename"
      onClick={edit}
      onKeyDown={(e) => {
        if (e.key !== 'F2') return;
        e.preventDefault();
        edit();
      }}
      className="inspector-title"
    >
      <span className="truncate">{layer.name}</span>
      <PencilSimple size={12} weight="bold" aria-hidden="true" />
    </button>
  );
}

export function InspectorPanel() {
  const selectedId = useStore($selectedLayerId);
  const appearanceMode = useStore($appearanceMode);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);
  const isCanvas = selectedId === CANVAS_SELECTION_ID;

  return (
    <aside aria-label="Inspector" className="inspector-panel w-[280px] shrink-0 min-h-0 flex flex-col">
      <div className="editor-panel-header">
        {layer && !isCanvas ? (
          <LayerNameField key={layer.id} layer={layer} />
        ) : (
          <span className="font-semibold truncate">{isCanvas ? 'Canvas' : 'Inspector'}</span>
        )}
      </div>

      {isCanvas ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-3 py-3 text-xs font-semibold text-[#ebebf5]">Color</div>
          {appearanceMode !== 'default' && (
            <p className="px-3 pb-3 glass-setting-caption">Colors apply to Default appearance. Dark and Clear use automatic backgrounds.</p>
          )}
          <BackgroundControls />
        </div>
      ) : !layer ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-[#a1a1aa] text-center max-w-44 leading-relaxed">
            Select a layer to inspect its properties
          </p>
        </div>
      ) : (
        <div key={layer.id} className="flex-1 min-h-0 overflow-y-auto">
          <CompositionSection />
          {layer.type === 'group' ? (
            <GroupColorSection />
          ) : (
            <>
              <ColorSection />
              <LiquidGlassSection />
            </>
          )}
        </div>
      )}
    </aside>
  );
}
