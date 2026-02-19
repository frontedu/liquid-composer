import React from 'react';
import { useStore } from '@nanostores/react';
import { $selectedLayerId } from '../../store/uiStore';
import { $layers } from '../../store/iconStore';
import { ColorSection } from './ColorSection';
import { LiquidGlassSection } from './LiquidGlassSection';
import { CompositionSection } from './CompositionSection';

export function InspectorPanel() {
  const selectedId = useStore($selectedLayerId);
  const layers = useStore($layers);
  const layer = layers.find((l) => l.id === selectedId);

  return (
    <div className="w-[220px] bg-[#1c1c1e] border-l border-[#2c2c2e] flex flex-col overflow-y-auto">
      <div className="flex items-center border-b border-[#2c2c2e] px-3 h-9 shrink-0">
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
        <div className="flex-1 overflow-y-auto">
          <ColorSection />
          <LiquidGlassSection />
          <CompositionSection />
        </div>
      )}
    </div>
  );
}
