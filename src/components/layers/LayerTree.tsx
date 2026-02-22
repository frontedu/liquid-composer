import React, { useRef, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { $layers, addLayer, addGroup, reorderLayer, moveLayerToGroup } from '../../store/iconStore';
import { LayerItem } from './LayerItem';
import type { Layer } from '../../types/index';

function buildTree(layers: Layer[]): { layer: Layer; children: Layer[] }[] {
  const roots = layers.filter((l) => l.parentId === null).sort((a, b) => b.order - a.order);
  return roots.map((layer) => ({
    layer,
    children: layers.filter((l) => l.parentId === layer.id).sort((a, b) => b.order - a.order),
  }));
}

function FileUploadZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === 'image/svg+xml' || f.type === 'image/png' || f.type === 'image/jpeg',
      );
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`mx-2 my-1 border-2 border-dashed rounded-lg p-3 flex flex-col items-center gap-1 cursor-pointer transition-colors
        ${over ? 'border-[#0a84ff] bg-[#0a84ff]/10' : 'border-[#3a3a3c] hover:border-[#636366]'}`}
    >
      <svg className="w-5 h-5 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
      </svg>
      <span className="text-xs text-[#636366] text-center">Drop SVG/PNG or click to add</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function LayerTree() {
  const layers = useStore($layers);
  const [draggingId, setDraggingId]   = useState<string | null>(null);
  const [dragOverId, setDragOverId]   = useState<string | null>(null);
  const tree = buildTree(layers);

  const handleFiles = useCallback((files: File[]) => {
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      addLayer(url, file.name);
    });
  }, []);

  const handleDragOver = useCallback((id: string) => setDragOverId(id), []);

  const handleDrop = useCallback(
    (targetId: string) => {
      if (draggingId && draggingId !== targetId) {
        const dragging = layers.find((l) => l.id === draggingId);
        const target   = layers.find((l) => l.id === targetId);
        if (dragging && target) {
          if (target.type === 'group') {
            // Drop ON a group → move layer inside the group
            moveLayerToGroup(draggingId, targetId);
          } else {
            // Drop on a regular layer → reparent if needed, then reorder at target's level
            if (dragging.parentId !== target.parentId) {
              moveLayerToGroup(draggingId, target.parentId);
            }
            reorderLayer(draggingId, target.order);
          }
        }
      }
      setDraggingId(null);
      setDragOverId(null);
    },
    [draggingId, layers],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2c2c2e]">
        <span className="text-xs font-medium text-[#ebebf5]">Layers</span>
        <div className="flex items-center gap-1">
          <button
            onClick={addGroup}
            title="Add group"
            className="p-1 rounded hover:bg-[#3a3a3c] text-[#636366] hover:text-[#ebebf5] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </button>
          <button
            onClick={() => addLayer()}
            title="Add layer"
            className="p-1 rounded hover:bg-[#3a3a3c] text-[#636366] hover:text-[#ebebf5] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 ? (
          <FileUploadZone onFiles={handleFiles} />
        ) : (
          <>
            <FileUploadZone onFiles={handleFiles} />
            {tree.map(({ layer, children }) => (
              <div key={layer.id} onDragEnd={handleDragEnd}>
                <LayerItem
                  layer={layer}
                  depth={0}
                  onDragStart={setDraggingId}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDropTarget={
                    dragOverId === layer.id &&
                    !!draggingId &&
                    draggingId !== layer.id &&
                    layer.type === 'group'
                  }
                />
                {layer.type === 'group' && !layer.collapsed &&
                  children.map((child) => (
                    <LayerItem
                      key={child.id}
                      layer={child}
                      depth={1}
                      onDragStart={setDraggingId}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      isDropTarget={false}
                    />
                  ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
