import { LayerTree } from '../layers/LayerTree';

export function LeftPanel() {
  return (
    <aside aria-label="Layers" className="layer-sidebar flex flex-col min-h-0 shrink-0">
      <div className="flex-1 min-h-0">
        <LayerTree />
      </div>
    </aside>
  );
}
