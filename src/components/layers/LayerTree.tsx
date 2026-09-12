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
import { $persistenceEnabled, $selectedLayerId, selectLayer, CANVAS_SELECTION_ID } from '../../store/uiStore';
import { clearPersistence } from '../../store/persistence';
import { LayerItem } from './LayerItem';
import { Toggle } from '../ui/Toggle';
import type { Layer } from '../../types/index';
import { Folder, Plus, CloudArrowDown, Trash, Square } from '@phosphor-icons/react';

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

function DropGap({
  isActive,
  depth,
  onDragOver,
  onDrop,
}: {
  isActive: boolean;
  depth: number;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      style={{ paddingLeft: `${(depth + 1) * 12}px`, height: 4, position: 'relative' }}
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
      className="layer-import"
      data-drag-over={over}
    >
      <button type="button" onClick={() => inputRef.current?.click()}>
        <Plus size={18} />
        <span>
          Import Artwork…
          <span className="layer-import-caption">Drop SVG, PNG, or JPEG</span>
        </span>
      </button>
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

function SettingsDropdown() {
  const persistenceEnabled = useStore($persistenceEnabled);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus();
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      menuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef} onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Save settings"
        aria-label="Save settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="save-settings-popover"
        className="editor-icon-button"
      >
        <CloudArrowDown size={16} />
      </button>
      {open && (
        <div
          id="save-settings-popover"
          role="dialog"
          aria-label="Save settings"
          className="editor-popover editor-settings-popover"
        >
          <div className="flex items-center justify-between px-3 py-[5px]">
            <span className="text-xs font-medium text-[#d1d1d6]">
              Auto-save
            </span>
            <Toggle ariaLabel="Auto-save" checked={persistenceEnabled} onChange={(v) => $persistenceEnabled.set(v)} />
          </div>
          <div className="mx-2 my-1" style={{ height: '0.5px', background: 'rgba(255,255,255,0.08)' }} />
          <button
            onClick={() => {
              if (window.confirm('Reset all saved data? This action cannot be undone.')) {
                setOpen(false);
                clearPersistence();
              }
            }}
            className="editor-menu-item editor-menu-danger"
          >
            <Trash size={13} weight="bold" />
            Reset Progress
          </button>
        </div>
      )}
    </div>
  );
}

export function LayerTree() {
  const layers = useStore($layers);
  const selectedId = useStore($selectedLayerId);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeGapKey, setActiveGapKey] = useState<string | null>(null);
  const [groupHoverId, setGroupHoverId] = useState<string | null>(null);
  const [edgeTarget, setEdgeTarget] = useState<{ layerId: string; position: 'before' | 'after' } | null>(null);

  const rows = buildRows(layers);
  const draggingLayer = draggingId ? layers.find((l) => l.id === draggingId) : undefined;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedId = $selectedLayerId.get();
        if (selectedId && selectedId !== CANVAS_SELECTION_ID) {
          e.preventDefault();
          removeLayer(selectedId);
          selectLayer(null);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleFiles = useCallback((files: File[]) => {
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      addLayer(url, file.name);
    });
  }, []);

  const clearTargets = useCallback(() => {
    setActiveGapKey(null);
    setGroupHoverId(null);
    setEdgeTarget(null);
  }, []);

  const resetDrag = useCallback(() => {
    setDraggingId(null);
    clearTargets();
  }, [clearTargets]);

  const handleGapDrop = useCallback(
    (parentId: string | null, targetId: string, position: 'before' | 'after') => {
      if (!draggingId) return;
      const allLayers = $layers.get();
      const dragging = allLayers.find((l) => l.id === draggingId);
      if (!dragging || dragging.id === targetId) return;
      if (dragging.type === 'group' && parentId !== null) return;
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
      if (!draggingId || draggingId === groupId || draggingLayer?.type === 'group') return;
      moveLayerToGroup(draggingId, groupId);
      resetDrag();
    },
    [draggingId, draggingLayer, resetDrag],
  );

  const zoneFor = (e: React.DragEvent<HTMLDivElement>, layer: Layer): 'before' | 'after' | 'inside' => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientY - rect.top) / rect.height;
    if (layer.type === 'group' && draggingLayer?.type !== 'group') {
      if (layer.collapsed) return t < 0.25 ? 'before' : t > 0.75 ? 'after' : 'inside';
      return t < 0.3 ? 'before' : 'inside';
    }
    return t < 0.5 ? 'before' : 'after';
  };

  const groupIntoGroup = (parentId: string | null) => draggingLayer?.type === 'group' && parentId !== null;
  const canTarget = (layer: Layer) => !!draggingId && draggingId !== layer.id && layer.parentId !== draggingId && !groupIntoGroup(layer.parentId);

  const handleItemDragOver = (e: React.DragEvent<HTMLDivElement>, layer: Layer) => {
    if (!canTarget(layer)) { clearTargets(); return; }
    const zone = zoneFor(e, layer);
    setActiveGapKey(null);
    if (zone === 'inside') {
      setEdgeTarget(null);
      setGroupHoverId(layer.id);
    } else {
      setGroupHoverId(null);
      setEdgeTarget((prev) => (prev?.layerId === layer.id && prev.position === zone ? prev : { layerId: layer.id, position: zone }));
    }
  };

  const handleItemDrop = (e: React.DragEvent<HTMLDivElement>, layer: Layer) => {
    if (!canTarget(layer)) { resetDrag(); return; }
    const zone = zoneFor(e, layer);
    if (zone === 'inside') {
      const first = layers.filter((l) => l.parentId === layer.id).sort((a, b) => b.order - a.order)[0];
      if (first && !layer.collapsed) handleGapDrop(layer.id, first.id, 'before');
      else handleInsideDrop(layer.id);
    } else {
      handleGapDrop(layer.parentId, layer.id, zone);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="editor-panel-header">
        <span className="font-semibold">Layers</span>
        <div className="flex items-center">
          <SettingsDropdown />
          <button
            onClick={addGroup}
            title="Add group"
            aria-label="Add group"
            className="editor-icon-button"
          >
            <Folder size={16} />
          </button>
          <button
            onClick={() => addLayer()}
            title="Add layer"
            aria-label="Add layer"
            className="editor-icon-button"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col"
        onDragEnd={resetDrag}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearTargets(); }}
      >
        {layers.length === 0 ? (
          <FileUploadZone onFiles={handleFiles} />
        ) : (
          <>
            <FileUploadZone onFiles={handleFiles} />

            {rows.map((row) => {
              if (row.kind === 'gap') {
                const isActive = activeGapKey === row.key;
                return (
                  <DropGap
                    key={row.key}
                    isActive={isActive}
                    depth={row.depth}
                    onDragOver={(e) => {
                      if (groupIntoGroup(row.parentId)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveGapKey(row.key);
                      setGroupHoverId(null);
                      setEdgeTarget(null);
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
                      setEdgeTarget(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleInsideDrop(row.groupId);
                    }}
                  />
                );
              }

              const { layer, depth } = row;
              return (
                <LayerItem
                  key={layer.id}
                  layer={layer}
                  depth={depth}
                  isDragging={draggingId === layer.id}
                  isInsideTarget={layer.type === 'group' && groupHoverId === layer.id}
                  dropEdge={edgeTarget?.layerId === layer.id ? edgeTarget.position : null}
                  onDragStart={(id) => { setDraggingId(id); clearTargets(); }}
                  onDragEnd={resetDrag}
                  onDragOver={(e) => handleItemDragOver(e, layer)}
                  onDrop={(e) => handleItemDrop(e, layer)}
                />
              );
            })}
          </>
        )}
      </div>
      <button
        type="button"
        draggable={false}
        aria-pressed={selectedId === CANVAS_SELECTION_ID}
        onClick={() => selectLayer(CANVAS_SELECTION_ID)}
        className="layer-canvas-button"
      >
        <Square size={18} aria-hidden="true" />
        Canvas
      </button>
    </div>
  );
}
