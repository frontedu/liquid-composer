import React from 'react';
import { TopToolbar } from './TopToolbar';
import { LeftPanel } from './LeftPanel';
import { IconCanvas } from '../canvas/IconCanvas';
import { InspectorPanel } from '../inspector/InspectorPanel';

export function AppLayout() {
  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-[#ebebf5] font-system overflow-hidden">
      <TopToolbar />
      <div className="flex flex-1 overflow-hidden">
        <LeftPanel />
        <IconCanvas />
        <InspectorPanel />
      </div>
    </div>
  );
}
