import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { Square, Stack, SlidersHorizontal, type Icon } from '@phosphor-icons/react';
import { TopToolbar } from './TopToolbar';
import { LeftPanel } from './LeftPanel';
import { IconCanvas } from '../canvas/IconCanvas';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { useFileDrop } from '../useFileDrop';
import { $mobilePane, setMobilePane, type MobilePane } from '../../store/uiStore';

const PANES: { value: MobilePane; label: string; icon: Icon }[] = [
  { value: 'canvas',    label: 'Canvas',    icon: Square            },
  { value: 'layers',    label: 'Layers',    icon: Stack             },
  { value: 'inspector', label: 'Inspector', icon: SlidersHorizontal },
];

export function AppLayout() {
  useFileDrop();
  const pane = useStore($mobilePane);
  const paneIndex = PANES.findIndex((p) => p.value === pane);
  const [slide, setSlide] = useState({ index: paneIndex, direction: 'right' });
  if (slide.index !== paneIndex) setSlide({ index: paneIndex, direction: paneIndex > slide.index ? 'right' : 'left' });
  return (
    <div className="editor-app flex flex-col h-screen text-[#ebebf5] font-system overflow-hidden">
      <TopToolbar />
      <main className="editor-workspace flex flex-1 min-h-0 overflow-hidden" data-mobile-pane={pane}>
        <LeftPanel />
        <IconCanvas />
        <InspectorPanel />
      </main>
      <nav className="editor-tabbar" aria-label="Panels">
        <span
          className="editor-tabbar-indicator"
          data-direction={slide.direction}
          style={{ left: `${(paneIndex * 100) / PANES.length}%`, right: `${((PANES.length - 1 - paneIndex) * 100) / PANES.length}%` }}
          aria-hidden="true"
        />
        {PANES.map(({ value, label, icon: PaneIcon }) => (
          <button key={value} type="button" aria-pressed={pane === value} onClick={() => setMobilePane(value)}>
            <PaneIcon size={22} weight={pane === value ? 'fill' : 'regular'} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
