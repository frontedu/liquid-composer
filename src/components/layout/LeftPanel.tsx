import React from 'react';
import { useStore } from '@nanostores/react';
import { $iconName, $iconModified } from '../../store/iconStore';
import { LayerTree } from '../layers/LayerTree';

export function LeftPanel() {
  const name = useStore($iconName);
  const modified = useStore($iconModified);

  return (
    <div className="w-[280px] bg-[#1c1c1e] border-r border-[#2c2c2e] flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-[#2c2c2e] shrink-0">
        <div className="w-5 h-5 rounded-[5px] bg-gradient-to-br from-blue-400 to-purple-600 flex-shrink-0" />
        <span className="text-xs font-medium text-[#ebebf5] truncate flex-1">{name}</span>
        {modified && <div className="w-1.5 h-1.5 rounded-full bg-[#636366] flex-shrink-0" />}
      </div>
      <div className="flex-1 overflow-hidden">
        <LayerTree />
      </div>
    </div>
  );
}
