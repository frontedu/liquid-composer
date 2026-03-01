import { atom } from 'nanostores';
import { $layers, $background, $iconName, bgColorsFromHueTint } from './iconStore';
import { $appearanceMode, $lightAngle, $zoom, setAppearanceMode, setLightAngle, setZoom, $persistenceEnabled } from './uiStore';
import type { Layer, BackgroundConfig, AppearanceMode } from '../types/index';

const STORAGE_KEY = 'liquid-composer-state';
const ASSET_DB_NAME = 'liquid-composer-assets';
const ASSET_STORE_NAME = 'images';
const CURRENT_VERSION = 1;

/**
 * Tracks if there are changes that haven't been synced to localStorage yet.
 */
export const $hasUnsavedChanges = atom<boolean>(false);

interface StoredAppData {
  version: number;
  data: {
    iconName: string;
    layers: Layer[];
    background: BackgroundConfig;
    ui: {
      appearanceMode: AppearanceMode;
      lightAngle: number;
      zoom: number;
    }
  }
}

/**
 * Minimal IDB wrapper to store Blobs.
 */
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open(ASSET_DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(ASSET_STORE_NAME);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function setAsset(id: string, blob: Blob) {
  const db = await dbPromise;
  return new Promise((r, rej) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    tx.objectStore(ASSET_STORE_NAME).put(blob, id);
    tx.oncomplete = r;
    tx.onerror = rej;
  });
}

async function getAsset(id: string): Promise<Blob | null> {
  const db = await dbPromise;
  return new Promise((r) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readonly');
    const req = tx.objectStore(ASSET_STORE_NAME).get(id);
    req.onsuccess = () => r(req.result);
    req.onerror = () => r(null);
  });
}

async function removeAsset(id: string) {
    const db = await dbPromise;
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    tx.objectStore(ASSET_STORE_NAME).delete(id);
}

/**
 * Saves the current app state to localStorage and IndexedDB.
 */
async function saveState() {
  if (!$persistenceEnabled.get()) return;

  const layers = $layers.get();
  
  const state: StoredAppData = {
    version: CURRENT_VERSION,
    data: {
      iconName: $iconName.get(),
      layers: layers.map(l => ({
        ...l,
        blobUrl: undefined, // Don't persist temporary URLs
      })),
      background: $background.get(),
      ui: {
        appearanceMode: $appearanceMode.get(),
        lightAngle: $lightAngle.get(),
        zoom: $zoom.get(),
      }
    }
  };
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $hasUnsavedChanges.set(false);
    
    // We don't save blobs *every* sync here because we'd need the actual Blob/File object.
    // Instead, we ensure the IDB is in sync when layers are added/removed.
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e);
  }
}

/**
 * Loads and migrates state from localStorage and IndexedDB.
 */
export async function initPersistence() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const persisted = JSON.parse(raw) as StoredAppData;
      
      if (persisted.version === 1) {
        const { data } = persisted;
        
        // Restore Layer Assets from IDB
        const layersWithBlobs = await Promise.all((data.layers || []).map(async (l) => {
            if (l.type === 'layer') {
                const blob = await getAsset(l.id);
                if (blob) {
                    return { ...l, blobUrl: URL.createObjectURL(blob) };
                }
            }
            return l;
        }));

        if (data.iconName) $iconName.set(data.iconName);
        if (data.layers) $layers.set(layersWithBlobs as Layer[]);
        if (data.background) $background.set(data.background);
        
        if (data.ui) {
          if (data.ui.appearanceMode) setAppearanceMode(data.ui.appearanceMode);
          if (data.ui.lightAngle !== undefined) setLightAngle(data.ui.lightAngle);
          if (data.ui.zoom !== undefined) setZoom(data.ui.zoom);
        }
      }
    } catch (e) {
      console.error('Failed to parse persisted state:', e);
    }
  }

  // Auto-save listeners (metadata only)
  let timeout: number | null = null;
  const debouncedSave = () => {
    $hasUnsavedChanges.set(true);
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(saveState, 3000);
  };

  // Prevent data loss on accidental close
  window.addEventListener('beforeunload', (e) => {
    if ($hasUnsavedChanges.get() && $persistenceEnabled.get()) {
      e.preventDefault();
      e.returnValue = ''; // Required for Chrome
    }
  });

  // Track which layer IDs already have assets saved in IDB (pre-populate from restored layers)
  const persistedAssetIds = new Set<string>(
    $layers.get().filter(l => l.blobUrl).map(l => l.id)
  );

  // Sync blob assets to/from IDB whenever layers change
  $layers.listen(async (layers) => {
    // Save new blob assets
    for (const l of layers) {
      if (l.blobUrl && !persistedAssetIds.has(l.id)) {
        persistedAssetIds.add(l.id);
        try {
          const resp = await fetch(l.blobUrl);
          const blob = await resp.blob();
          await setAsset(l.id, blob);
        } catch {}
      }
    }
    // Remove IDB entries for deleted layers
    const currentIds = new Set(layers.map(l => l.id));
    for (const id of [...persistedAssetIds]) {
      if (!currentIds.has(id)) {
        persistedAssetIds.delete(id);
        removeAsset(id).catch(() => {});
      }
    }
  });

  $layers.listen(debouncedSave);
  $background.listen(debouncedSave);
  $iconName.listen(debouncedSave);
  $appearanceMode.listen(debouncedSave);
  $lightAngle.listen(debouncedSave);
  $zoom.listen(debouncedSave);
}

/**
 * Public helper to bind a file to a layer in IDB.
 * This should be called when a new layer is created.
 */
export async function persistLayerAsset(id: string, blob: Blob) {
    await setAsset(id, blob);
    saveState();
}

/**
 * Public helper to clean up assets for removed layers.
 */
export async function deleteLayerAsset(id: string) {
    await removeAsset(id);
    saveState();
}

/**
 * Clears all saved state and reloads the app.
 */
export async function clearPersistence() {
    $hasUnsavedChanges.set(false);
    $persistenceEnabled.set(false);
    localStorage.removeItem(STORAGE_KEY);
    const db = await dbPromise;
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    tx.objectStore(ASSET_STORE_NAME).clear();
    tx.oncomplete = () => {
        window.location.reload();
    };
}
