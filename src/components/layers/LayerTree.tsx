import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import {
  $layers,
  addLayer,
  addGroup,
  reorderLayer,
  moveLayerToGroup,
  removeLayer,
} from '../../store/iconStore';
import { $persistenceEnabled, $selectedLayerId, selectLayer } from '../../store/uiStore';
import { clearPersistence } from '../../store/persistence';
import { LayerItem } from './LayerItem';
import { Toggle } from '../ui/Toggle';
import type { Layer } from '../../types/index';
import { Folder, Plus, CloudArrowDown, Trash } from '@phosphor-icons/react';

// ─── Flat row model ────────────────────────────────────────────────────────────
// We flatten the tree into a single ordered array of typed rows.
// This avoids React.Fragment nesting and makes the DnD logic straightforward.

type ItemRow = { kind: 'item'; layer: Layer; depth: number };
type GapRow = {
  kind: 'gap';
  key: string;
  parentId: string | null;
  targetId: string;
  position: 'before' | 'after';
  depth: number;
};
type EmptyGroupRow = { kind: 'empty-group'; key: string; groupId: string; depth: number };
type Row = ItemRow | GapRow | EmptyGroupRow;

function buildRows(layers: Layer[]): Row[] {
  const rows: Row[] = [];
  const roots = layers
    .filter((l) => l.parentId === null)
    .sort((a, b) => b.order - a.order);

  if (roots.length === 0) return rows;

  // Gap before the very first root item
  rows.push({
    kind: 'gap',
    key: `root:${roots[0].id}:before`,
    parentId: null,
    targetId: roots[0].id,
    position: 'before',
    depth: 0,
  });

  for (const root of roots) {
    rows.push({ kind: 'item', layer: root, depth: 0 });

    if (root.type === 'group' && !root.collapsed) {
      const children = layers
        .filter((l) => l.parentId === root.id)
        .sort((a, b) => b.order - a.order);

      if (children.length === 0) {
        rows.push({ kind: 'empty-group', key: `empty:${root.id}`, groupId: root.id, depth: 1 });
      } else {
        // Gap before first child
        rows.push({
          kind: 'gap',
          key: `${root.id}:${children[0].id}:before`,
          parentId: root.id,
          targetId: children[0].id,
          position: 'before',
          depth: 1,
        });
        for (const child of children) {
          rows.push({ kind: 'item', layer: child, depth: 1 });
          rows.push({
            kind: 'gap',
            key: `${root.id}:${child.id}:after`,
            parentId: root.id,
            targetId: child.id,
            position: 'after',
            depth: 1,
          });
        }
      }
    }

    // Gap after this root item (also serves as gap between consecutive root items)
    rows.push({
      kind: 'gap',
      key: `root:${root.id}:after`,
      parentId: null,
      targetId: root.id,
      position: 'after',
      depth: 0,
    });
  }

  return rows;
}

// ─── Drop Gap ──────────────────────────────────────────────────────────────────
function DropGap({
  isActive,
  depth,
  prominent,
  onDragOver,
  onDrop,
}: {
  isActive: boolean;
  depth: number;
  /** larger hit area — used for root-level gaps when a child layer is being dragged */
  prominent?: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const height = isActive ? 14 : prominent ? 10 : 3;
  return (
    <div
      style={{
        paddingLeft: `${(depth + 1) * 12}px`,
        height,
        position: 'relative',
        transition: 'height 60ms',
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {isActive && (
        <div
          style={{
            position: 'absolute',
            left: `${(depth + 1) * 12 + 4}px`,
            right: 4,
            top: '50%',
            height: 2,
            transform: 'translateY(-50%)',
            background: '#0a84ff',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

// ─── File Upload Zone ──────────────────────────────────────────────────────────
function FileUploadZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files).filter(
          (f) => f.type === 'image/svg+xml' || f.type === 'image/png' || f.type === 'image/jpeg',
        );
        if (files.length) onFiles(files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`mx-2 my-1 border-2 border-dashed rounded-lg p-3 flex flex-col items-center gap-1 cursor-pointer transition-colors
        ${over ? 'border-[#0a84ff] bg-[#0a84ff]/10' : 'border-[#3a3a3c] hover:border-[#636366]'}`}
    >
      <Plus size={18} weight="bold" className="text-[#636366]" />
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

// ─── Settings Dropdown ─────────────────────────────────────────────────────────
function SettingsDropdown() {
  const persistenceEnabled = useStore($persistenceEnabled);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Save settings"
        className={`p-1 rounded hover:bg-[#3a3a3c] transition-colors ${
          open ? 'text-[#ebebf5]' : 'text-[#636366] hover:text-[#ebebf5]'
        }`}
      >
        <CloudArrowDown size={14} weight="bold" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-[100] py-1.5 rounded-[12px] shadow-xl w-44"
          style={{
            background: 'rgba(30,30,32,0.95)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.07)',
          }}
        >
          <div className="flex items-center justify-between px-3 py-[5px]">
            <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Auto-save
            </span>
            <Toggle checked={persistenceEnabled} onChange={(v) => $persistenceEnabled.set(v)} />
          </div>
          <div className="mx-2 my-1" style={{ height: '0.5px', background: 'rgba(255,255,255,0.08)' }} />
          <button
            onClick={() => {
              if (window.confirm('Reset all saved data? This action cannot be undone.')) {
                setOpen(false);
                clearPersistence();
              }
            }}
            className="w-full text-left px-3 py-[5px] text-[11px] font-medium transition-colors flex items-center gap-1.5"
            style={{ color: '#ff453a' }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,69,58,0.10)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          >
            <Trash size={13} weight="bold" />
            Reset Progress
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Layer Tree ────────────────────────────────────────────────────────────────
export function LayerTree() {
  const layers = useStore($layers);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeGapKey, setActiveGapKey] = useState<string | null>(null);
  const [groupHoverId, setGroupHoverId] = useState<string | null>(null);

  const rows = buildRows(layers);

  // True when the item being dragged is a child inside a group
  const draggingIsChild = draggingId
    ? (layers.find((l) => l.id === draggingId)?.parentId ?? null) !== null
    : false;

  // ── Keyboard delete ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedId = $selectedLayerId.get();
        if (selectedId) {
          e.preventDefault();
          removeLayer(selectedId);
          selectLayer(null);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── File upload ──────────────────────────────────────────────────────────────
  const handleFiles = useCallback((files: File[]) => {
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      addLayer(url, file.name);
    });
  }, []);

  // ── Drag state reset ─────────────────────────────────────────────────────────
  const resetDrag = useCallback(() => {
    setDraggingId(null);
    setActiveGapKey(null);
    setGroupHoverId(null);
  }, []);

  // ── Gap drop handler ─────────────────────────────────────────────────────────
  const handleGapDrop = useCallback(
    (parentId: string | null, targetId: string, position: 'before' | 'after') => {
      if (!draggingId) return;
      const allLayers = $layers.get();
      const dragging = allLayers.find((l) => l.id === draggingId);
      if (!dragging || dragging.id === targetId) return;
      // Reparent if needed, then reorder
      if (dragging.parentId !== parentId) {
        moveLayerToGroup(draggingId, parentId);
      }
      reorderLayer(draggingId, targetId, position);
      resetDrag();
    },
    [draggingId, resetDrag],
  );

  // ── Inside-group drop (empty groups / collapsed groups) ──────────────────────
  const handleInsideDrop = useCallback(
    (groupId: string) => {
      if (!draggingId || draggingId === groupId) return;
      moveLayerToGroup(draggingId, groupId);
      resetDrag();
    },
    [draggingId, resetDrag],
  );

  // ── Eject child to root, positioned just before its parent group ──────────────
  const handleEjectAboveGroup = useCallback(
    (groupId: string) => {
      if (!draggingId) return;
      const allLayers = $layers.get();
      const dragging = allLayers.find((l) => l.id === draggingId);
      if (!dragging || dragging.parentId !== groupId) return;
      moveLayerToGroup(draggingId, null);
      reorderLayer(draggingId, groupId, 'before');
      resetDrag();
    },
    [draggingId, resetDrag],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2c2c2e]">
        <span className="text-xs font-medium text-[#ebebf5]">Layers</span>
        <div className="flex items-center gap-1">
          <SettingsDropdown />
          <div className="w-px h-3.5 bg-[#3a3a3c] mx-0.5" />
          <button
            onClick={addGroup}
            title="Add group"
            className="p-1 rounded hover:bg-[#3a3a3c] text-[#636366] hover:text-[#ebebf5] transition-colors"
          >
            <Folder size={14} weight="bold" />
          </button>
          <button
            onClick={() => addLayer()}
            title="Add layer"
            className="p-1 rounded hover:bg-[#3a3a3c] text-[#636366] hover:text-[#ebebf5] transition-colors"
          >
            <Plus size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* Scrollable list */}
      <div
        className="flex-1 overflow-y-auto flex flex-col"
        onDragEnd={resetDrag}
      >
        {layers.length === 0 ? (
          <FileUploadZone onFiles={handleFiles} />
        ) : (
          <>
            <FileUploadZone onFiles={handleFiles} />

            {rows.map((row) => {
              // ── Gap row ─────────────────────────────────────────────────────
              if (row.kind === 'gap') {
                const isActive = activeGapKey === row.key;
                return (
                  <DropGap
                    key={row.key}
                    isActive={isActive}
                    depth={row.depth}
                    prominent={row.depth === 0 && !!draggingId}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveGapKey(row.key);
                      setGroupHoverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleGapDrop(row.parentId, row.targetId, row.position);
                    }}
                  />
                );
              }

              // ── Empty group placeholder (invisible drop zone, no text) ────────
              if (row.kind === 'empty-group') {
                return (
                  <div
                    key={row.key}
                    style={{ paddingLeft: `${(row.depth + 1) * 12}px`, height: 14 }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setGroupHoverId(row.groupId);
                      setActiveGapKey(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleInsideDrop(row.groupId);
                    }}
                  />
                );
              }

              // ── Layer / Group item ───────────────────────────────────────────
              const { layer, depth } = row;
              // The expanded group header is an eject target when we're dragging
              // one of its own children over it
              const isMyChild = draggingIsChild &&
                layers.find((l) => l.id === draggingId)?.parentId === layer.id;
              const isEjectTarget = layer.type === 'group' && !layer.collapsed && !!isMyChild;
              const isInsideTarget =
                layer.type === 'group' && groupHoverId === layer.id && !isEjectTarget;

              return (
                <LayerItem
                  key={layer.id}
                  layer={layer}
                  depth={depth}
                  isDragging={draggingId === layer.id}
                  isInsideTarget={isInsideTarget || isEjectTarget}
                  onDragStart={(id) => { setDraggingId(id); setActiveGapKey(null); }}
                  onDragEnd={resetDrag}
                  onDragOver={() => {
                    if (layer.type === 'group' && !layer.collapsed && isMyChild) {
                      // Dragging own child over group header → eject above
                      setGroupHoverId(null);
                      setActiveGapKey(null);
                    } else if (layer.type === 'group') {
                      // Both collapsed and expanded groups accept drops
                      setGroupHoverId(layer.id);
                      setActiveGapKey(null);
                    } else {
                      setGroupHoverId(null);
                      setActiveGapKey(null);
                    }
                  }}
                  onDrop={
                    isEjectTarget
                      ? () => handleEjectAboveGroup(layer.id)
                      : layer.type === 'group'
                      ? () => handleInsideDrop(layer.id)
                      : undefined
                  }
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
