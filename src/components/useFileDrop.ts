import { useEffect } from 'react';
import { atom } from 'nanostores';
import { addLayer } from '../store/iconStore';
import { naturalScale } from '../engine/IconDocument';

export type FileDropZone = 'canvas' | 'layers' | 'import';

export const $fileDropZone = atom<FileDropZone | null>(null);

const EXTENSION_TYPE: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const ACCEPTED_TYPE = new Set(Object.values(EXTENSION_TYPE));
const UNTYPED = /^$|^(text|application)\/xml$|^application\/octet-stream$/;

function imageType(file: File): string | null {
  if (ACCEPTED_TYPE.has(file.type)) return file.type;
  if (!UNTYPED.test(file.type)) return null;
  return EXTENSION_TYPE[file.name.split('.').pop()!.toLowerCase()] ?? null;
}

export function imageFiles(files: Iterable<File>): File[] {
  const out: File[] = [];
  for (const file of files) {
    const type = imageType(file);
    if (type) out.push(type === file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified }));
  }
  return out;
}

const NATURAL_MIN = 25; // % of the icon
const GRID_SCALE = 80; // % of the icon

const importScale = (natural: number | undefined, svg: boolean) =>
  natural === undefined ? undefined : natural > 100 ? 100 : svg && natural < NATURAL_MIN ? GRID_SCALE : natural;

export async function addImageFiles(files: File[]) {
  const scales = await Promise.all(files.map(async (f) => {
    const svg = f.type === 'image/svg+xml';
    return importScale(await naturalScale(f, svg), svg);
  }));
  files.forEach((file, i) => addLayer(URL.createObjectURL(file), file.name, null, scales[i]));
}

function dragAccepts(dt: DataTransfer | null): boolean {
  if (!dt?.types.includes('Files')) return false;
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  return !items.length || items.some((i) => ACCEPTED_TYPE.has(i.type) || UNTYPED.test(i.type));
}

const zoneOf = (target: EventTarget | null) =>
  ((target as Element | null)?.closest?.('[data-file-drop]') as HTMLElement | null)?.dataset.fileDrop as FileDropZone | undefined ?? null;

// ── Window listeners: one drop path, no navigation on stray drops ──
export function useFileDrop() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      const zone = dragAccepts(e.dataTransfer) ? zoneOf(e.target) : null;
      e.dataTransfer.dropEffect = zone ? 'copy' : 'none';
      $fileDropZone.set(zone);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) $fileDropZone.set(null);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      $fileDropZone.set(null);
      if (!zoneOf(e.target)) return;
      const files = imageFiles(e.dataTransfer.files);
      if (files.length) addImageFiles(files).catch(console.error);
    };
    const clear = () => $fileDropZone.set(null);
    window.addEventListener('dragenter', onDragOver);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('dragenter', onDragOver);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', clear);
      clear();
    };
  }, []);
}
