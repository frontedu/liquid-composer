import { useRef, useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import {
  $layers,
  $iconName,
  $background,
  addLayer,
  addGroup,
  removeLayer,
  duplicateLayer,
  arrangeLayer,
  nudgeLayer,
  copyLayerStyle,
  pasteLayerStyle,
  copiedLayerMarker,
  copyLayer,
  cutLayer,
  pasteLayers,
  setHistoryGesture,
  undo,
  redo,
} from '../../store/iconStore';
import { $persistenceEnabled, $selectedLayerId, $showGrid, selectLayer, inspectLayer, CANVAS_SELECTION_ID } from '../../store/uiStore';
import { clearPersistence } from '../../store/persistence';
import { downloadIconDocument } from '../../engine/IconDocument';
import { $fileDropZone, addImageFiles, imageFiles } from '../useFileDrop';
import { LayerItem } from './LayerItem';
import { useLayerDrag, LAYER_INDENT } from './useLayerDrag';
import { Toggle } from '../ui/Toggle';
import type { Layer } from '../../types/index';
import { Plus, ArrowCounterClockwise, DownloadSimple, FolderSimplePlus, GearSix, Square } from '@phosphor-icons/react';

type ItemRow = { kind: 'item'; layer: Layer; depth: number };
type EmptyGroupRow = { kind: 'empty-group'; groupId: string };
type Row = ItemRow | EmptyGroupRow;

function buildRows(layers: Layer[]): Row[] {
  const rows: Row[] = [];
  const byOrder = (a: Layer, b: Layer) => b.order - a.order;
  for (const root of layers.filter((l) => l.parentId === null).sort(byOrder)) {
    rows.push({ kind: 'item', layer: root, depth: 0 });
    if (root.type !== 'group' || root.collapsed) continue;
    const children = layers.filter((l) => l.parentId === root.id).sort(byOrder);
    if (!children.length) rows.push({ kind: 'empty-group', groupId: root.id });
    for (const child of children) rows.push({ kind: 'item', layer: child, depth: 1 });
  }
  return rows;
}

function FileUploadZone({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
  const over = useStore($fileDropZone) === 'import';
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="layer-import"
      data-file-drop="import"
      data-drag-over={over}
      data-compact={compact}
    >
      <button type="button" onClick={() => inputRef.current?.click()} title="Import SVG, PNG, or JPEG">
        <Plus size={compact ? 14 : 18} />
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
          const files = imageFiles(e.target.files ?? []);
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
    menuRef.current?.querySelector<HTMLButtonElement>('.editor-menu-item')?.focus();
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
        title="Document settings"
        aria-label="Document settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="save-settings-popover"
        className="editor-icon-button"
      >
        <GearSix size={16} />
      </button>
      {open && (
        <div
          id="save-settings-popover"
          role="dialog"
          aria-label="Document settings"
          className="editor-popover editor-settings-popover"
        >
          <button
            onClick={() => {
              setOpen(false);
              menuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus();
              downloadIconDocument($iconName.get(), $layers.get(), $background.get()).catch(console.error);
            }}
            className="editor-menu-item group"
          >
            <DownloadSimple size={14} weight="bold" />
            <span>
              Export .icon
              <span className="block whitespace-normal text-2xs text-[#8e8e93] group-hover:text-white/85 group-focus-visible:text-white/85">Reopen in Liquid Composer or Xcode</span>
            </span>
          </button>
          <div className="mx-2 my-1" style={{ height: '0.5px', background: 'rgba(255,255,255,0.08)' }} />
          <div className="flex items-center justify-between gap-3 px-2 py-[5px]">
            <span className="text-xs text-[#d1d1d6]">
              Auto-save
              <span className="block text-2xs text-[#8e8e93]">Keep this icon after reload</span>
            </span>
            <Toggle ariaLabel="Auto-save" checked={persistenceEnabled} onChange={(v) => $persistenceEnabled.set(v)} />
          </div>
          <div className="mx-2 my-1" style={{ height: '0.5px', background: 'rgba(255,255,255,0.08)' }} />
          <button
            onClick={() => {
              if (window.confirm('Reset the document and all saved data? This action cannot be undone.')) {
                setOpen(false);
                clearPersistence();
              }
            }}
            className="editor-menu-item editor-menu-danger"
          >
            <ArrowCounterClockwise size={14} weight="bold" />
            Reset Document…
          </button>
        </div>
      )}
    </div>
  );
}

export function LayerTree() {
  const layers = useStore($layers);
  const selectedId = useStore($selectedLayerId);
  const listRef = useRef<HTMLDivElement>(null);
  const fileZone = useStore($fileDropZone);
  const { dragId, target, onRowPointerDown } = useLayerDrag(listRef);

  const rows = buildRows(layers);

  useEffect(() => {
    let pasteFallback = 0;
    const handlePaste = (e: ClipboardEvent) => {
      clearTimeout(pasteFallback);
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.defaultPrevented || !e.clipboardData) return;
      const text = e.clipboardData.getData('text/plain');
      const files = imageFiles(e.clipboardData.files);
      const svg = /^\s*</.test(text) && /<svg[\s>]/i.test(text);
      const marker = copiedLayerMarker();
      if (!marker && !files.length && !svg) return;
      e.preventDefault();
      if (marker && (text === marker || (!files.length && !svg))) pasteLayers().catch(console.error);
      else addImageFiles(files.length ? files : [new File([text], 'image.svg', { type: 'image/svg+xml' })]).catch(console.error);
    };
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
        if (key === 'z' && !e.shiftKey ? undo() : redo()) e.preventDefault();
        return;
      }
      if (mod && e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        $showGrid.set(!$showGrid.get());
        return;
      }
      if (mod && !e.altKey && key === 'v') {
        pasteFallback = window.setTimeout(() => pasteLayers().catch(console.error));
        return;
      }
      const selectedId = $selectedLayerId.get();
      if (!selectedId || selectedId === CANVAS_SELECTION_ID) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeLayer(selectedId);
        selectLayer(null);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateLayer(selectedId).catch(console.error);
      } else if (mod && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        arrangeLayer(selectedId, e.key === ']' ? 'forward' : 'backward');
      } else if (mod && e.shiftKey && (e.code === 'KeyF' || e.code === 'KeyB')) {
        e.preventDefault();
        const forward = e.code === 'KeyF';
        arrangeLayer(selectedId, e.altKey ? (forward ? 'front' : 'back') : (forward ? 'forward' : 'backward'));
      } else if (mod && !e.altKey && !e.shiftKey && (key === 'c' || key === 'x')) {
        if (getSelection()?.toString()) return;
        e.preventDefault();
        const marker = key === 'c' ? copyLayer(selectedId) : cutLayer(selectedId);
        if (key === 'x') selectLayer(null);
        if (marker) navigator.clipboard?.writeText(marker).catch(() => {});
      } else if (mod && e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        copyLayerStyle(selectedId);
      } else if (mod && e.altKey && e.code === 'KeyV') {
        if (pasteLayerStyle(selectedId)) e.preventDefault();
      } else if (mod && e.key === 'ArrowUp') {
        const parentId = $layers.get().find((l) => l.id === selectedId)?.parentId;
        if (parentId) {
          e.preventDefault();
          selectLayer(parentId);
        }
      } else if (!mod && !e.altKey && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = ((e.shiftKey ? 10 : 1) * 100) / 1024; // 1 or 10 pt
        setHistoryGesture(e.repeat);
        nudgeLayer(
          selectedId,
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        );
        setHistoryGesture(false);
      }
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('paste', handlePaste);
    };
  }, []);

  const indicator = target?.kind === 'between' ? target : null;
  const insideId = target?.kind === 'inside' ? target.groupId : null;

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
            <FolderSimplePlus size={16} />
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
        ref={listRef}
        role="tree"
        aria-label="Layers"
        className="layer-list"
        data-dragging={!!dragId}
        data-file-drop="layers"
        data-file-over={fileZone === 'layers' || fileZone === 'import'}
      >
        <FileUploadZone onFiles={(files) => addImageFiles(files).catch(console.error)} compact={layers.length > 0} />
        {rows.map((row) => row.kind === 'empty-group' ? (
          <div
            key={`empty:${row.groupId}`}
            data-row-id={row.groupId}
            data-row-kind="empty"
            data-drop-inside={insideId === row.groupId}
            className="layer-empty-group"
            style={{ paddingLeft: 6 + LAYER_INDENT + 22 }}
          >
            No layers
          </div>
        ) : (
          <LayerItem
            key={row.layer.id}
            layer={row.layer}
            depth={row.depth}
            isDragging={!!dragId && (dragId === row.layer.id || dragId === row.layer.parentId)}
            isInsideTarget={insideId === row.layer.id}
            onPointerDown={onRowPointerDown}
          />
        ))}
        {indicator && (
          <div
            className="layer-drop-indicator"
            style={{ top: indicator.y, left: 8 + 6 + 16 + indicator.depth * LAYER_INDENT }}
            aria-hidden="true"
          />
        )}
      </div>
      <button
        type="button"
        draggable={false}
        aria-pressed={selectedId === CANVAS_SELECTION_ID}
        onClick={() => inspectLayer(CANVAS_SELECTION_ID)}
        className="layer-canvas-button"
      >
        <Square size={18} aria-hidden="true" />
        Canvas
      </button>
    </div>
  );
}
