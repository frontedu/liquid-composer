import React from 'react';
import { LayerTree } from '../layers/LayerTree';

export function LeftPanel() {
  return (
    <div className="w-[280px] bg-[#1c1c1e] border-r border-[#2c2c2e] flex flex-col overflow-hidden shrink-0">
      <div className="flex-1 overflow-hidden">
        <LayerTree />
      </div>
    </div>
  );
}
