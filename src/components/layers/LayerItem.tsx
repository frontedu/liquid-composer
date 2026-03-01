import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { $selectedLayerId, $hoveredLayerId, selectLayer } from '../../store/uiStore';
import { removeLayer, toggleLayerVisibility, toggleGroupCollapsed, updateLayer } from '../../store/iconStore';
import type { Layer } from '../../types/index';
import { CaretRight, Eye, EyeSlash, Trash, Folder, Image } from '@phosphor-icons/react';

interface LayerItemProps {
  layer: Layer;
  depth?: number;
  isDragging?: boolean;
  isInsideTarget?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
}

export function LayerItem({
  layer,
  depth = 0,
  isDragging = false,
  isInsideTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
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
      onDragStart={(e) => { e.stopPropagation(); onDragStart?.(layer.id); }}
      onDragEnd={(e) => { e.stopPropagation(); onDragEnd?.(); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver?.(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop?.(); }}
      onMouseEnter={() => $hoveredLayerId.set(layer.id)}
      onMouseLeave={() => $hoveredLayerId.set(null)}
      onClick={() => !editing && selectLayer(layer.id)}
      style={{ paddingLeft: `${(depth + 1) * 12}px`, opacity: isDragging ? 0.35 : 1 }}
      className={`flex items-center gap-2 py-1.5 pr-2 cursor-pointer select-none group transition-colors
        ${isSelected
          ? 'bg-[#0a84ff]/40 text-white'
          : isInsideTarget
          ? 'bg-[#0a84ff]/15 outline outline-1 outline-[#0a84ff]/50 text-[#ebebf5]'
          : 'text-[#ebebf5] hover:bg-[#2c2c2e]'}`}
    >
      {/* Collapse toggle (groups only) */}
      {isGroup ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleGroupCollapsed(layer.id); }}
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 transition-transform
            ${layer.collapsed ? '' : 'rotate-90'}`}
        >
          <CaretRight size={14} weight="bold" className="opacity-60" />
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
            <Folder size={14} weight="bold" className="text-[#636366]" />
          </div>
        ) : layer.blobUrl ? (
          <img src={layer.blobUrl} alt="" className="w-full h-full object-contain" />
        ) : (
          <Image size={14} weight="bold" className="text-[#636366]" />
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
          {layer.visible ? <Eye size={14} weight="bold" /> : <EyeSlash size={14} weight="bold" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); selectLayer(null); }}
          className="p-1 rounded hover:bg-red-500/20 text-red-400"
          title="Remove layer"
        >
          <Trash size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
