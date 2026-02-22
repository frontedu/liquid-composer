import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { $selectedLayerId, selectLayer } from '../../store/uiStore';
import { removeLayer, toggleLayerVisibility, toggleGroupCollapsed, updateLayer } from '../../store/iconStore';
import type { Layer } from '../../types/index';

interface LayerItemProps {
  layer: Layer;
  depth?: number;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDrop?: (targetId: string) => void;
  isDropTarget?: boolean;
}

export function LayerItem({
  layer,
  depth = 0,
  onDragStart,
  onDragOver,
  onDrop,
  isDropTarget,
}: LayerItemProps) {
  const selectedId = useStore($selectedLayerId);
  const isSelected = selectedId === layer.id;
  const isGroup = layer.type === 'group';

  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(layer.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setNameValue(layer.name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== layer.name) updateLayer(layer.id, { name: trimmed });
    setEditing(false);
  };

  return (
    <div
      draggable={!editing}
      onDragStart={() => onDragStart?.(layer.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(layer.id); }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(layer.id); }}
      onClick={() => !editing && selectLayer(layer.id)}
      style={{ paddingLeft: `${(depth + 1) * 12}px` }}
      className={`flex items-center gap-2 py-1.5 pr-2 cursor-pointer select-none group transition-colors
        ${isSelected
          ? 'bg-[#0a84ff] text-white'
          : isDropTarget
          ? 'bg-[#0a84ff]/20 ring-1 ring-inset ring-[#0a84ff]/60 text-[#ebebf5]'
          : 'text-[#ebebf5] hover:bg-[#2c2c2e]'}`}
    >
      {/* Collapse toggle (groups only) */}
      {isGroup ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleGroupCollapsed(layer.id); }}
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 transition-transform
            ${layer.collapsed ? '' : 'rotate-90'}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 opacity-60">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
          </svg>
        </button>
      ) : (
        <div className="w-4 h-4 flex-shrink-0" />
      )}

      {/* Thumbnail */}
      <div
        className="w-9 h-9 rounded-[5px] flex-shrink-0 overflow-hidden flex items-center justify-center p-1"
        style={{
          backgroundImage: isGroup ? undefined :
            'linear-gradient(45deg,#333 25%,transparent 25%),' +
            'linear-gradient(-45deg,#333 25%,transparent 25%),' +
            'linear-gradient(45deg,transparent 75%,#333 75%),' +
            'linear-gradient(-45deg,transparent 75%,#333 75%)',
          backgroundSize: '6px 6px',
          backgroundPosition: '0 0,0 3px,3px -3px,-3px 0',
          backgroundColor: '#272727',
        }}
      >
        {isGroup ? (
          <div className="w-full h-full rounded-[3px] flex items-center justify-center bg-[#2c2c2e]">
            <svg className="w-4 h-4 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </div>
        ) : layer.blobUrl ? (
          <img src={layer.blobUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <svg className="w-3.5 h-3.5 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </div>

      {/* Name (editable on double-click) */}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter')  commitRename();
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs bg-[#111] border border-[#0a84ff] rounded px-1 py-px focus:outline-none text-[#ebebf5]"
        />
      ) : (
        <span
          className="flex-1 text-xs truncate"
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Double-click to rename"
        >
          {layer.name}
        </span>
      )}

      {/* Actions (visible on hover / selected) */}
      <div className={`flex items-center gap-0.5 transition-opacity ${isSelected ? 'opacity-80' : 'opacity-0 group-hover:opacity-100'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
          className={`p-1 rounded hover:bg-black/20 ${!layer.visible ? 'opacity-40' : ''}`}
          title="Toggle visibility"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {layer.visible ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            )}
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); selectLayer(null); }}
          className="p-1 rounded hover:bg-red-500/20 text-red-400"
          title="Remove layer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
