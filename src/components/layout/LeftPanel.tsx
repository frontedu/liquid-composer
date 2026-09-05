import { LayerTree } from '../layers/LayerTree';

export function LeftPanel() {
  return (
    <div className="w-[280px] bg-[#131316] border-r border-white/[0.07] flex flex-col overflow-hidden shrink-0">
      <div className="flex-1 overflow-hidden">
        <LayerTree />
      </div>
    </div>
  );
}
