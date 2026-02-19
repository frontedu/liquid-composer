import React from 'react';
import { useStore } from '@nanostores/react';
import { $selectedLayerId, selectLayer } from '../../store/uiStore';
import { removeLayer, toggleLayerVisibility, toggleGroupCollapsed } from '../../store/iconStore';
import type { Layer } from '../../types/index';

interface LayerItemProps {
  layer: Layer;
  depth?: number;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDrop?: (targetId: string) => void;
}

export function LayerItem({ layer, depth = 0, onDragStart, onDragOver, onDrop }: LayerItemProps) {
  const selectedId = useStore($selectedLayerId);
  const isSelected = selectedId === layer.id;
  const isGroup = layer.type === 'group';

  return (
    <div
      draggable
      onDragStart={() => onDragStart?.(layer.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(layer.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(layer.id); }}
      onClick={() => selectLayer(layer.id)}
      style={{ paddingLeft: `${(depth + 1) * 12}px` }}
      className={`flex items-center gap-2 py-1 pr-2 cursor-pointer select-none group
        ${isSelected ? 'bg-[#0a84ff] text-white' : 'text-[#ebebf5] hover:bg-[#2c2c2e]'}`}
    >
      {isGroup ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleGroupCollapsed(layer.id); }}
          className={`w-3 h-3 flex items-center justify-center flex-shrink-0 transition-transform
            ${layer.collapsed ? '' : 'rotate-90'}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 opacity-60">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
        </button>
      ) : (
        <div className="w-3 h-3 flex-shrink-0" />
      )}

      <div className="w-6 h-6 rounded flex-shrink-0 overflow-hidden bg-[#2a2a2a] flex items-center justify-center">
        {isGroup ? (
          <svg className="w-4 h-4 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            />
          </svg>
        ) : layer.blobUrl ? (
          <img src={layer.blobUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <svg className="w-3 h-3 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        )}
      </div>

      <span className="flex-1 text-xs truncate">{layer.name}</span>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
          className={`p-0.5 rounded hover:bg-black/20 ${!layer.visible ? 'opacity-40' : ''}`}
          title="Toggle visibility"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {layer.visible ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            )}
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); selectLayer(null); }}
          className="p-0.5 rounded hover:bg-red-500/20 text-red-400"
          title="Remove layer"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
