import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { $iconName, $iconModified, updateBackground, $background } from '../../store/iconStore';
import { $appearanceMode, $lightAngle, $zoom, setAppearanceMode, setLightAngle, setZoom } from '../../store/uiStore';
import type { AppearanceMode, BackgroundPreset, BackgroundConfig } from '../../types/index';

const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200];

const BG_PRESETS: { id: BackgroundPreset; label: string; colors: [string, string] }[] = [
  { id: 'warm', label: 'Warm', colors: ['#ff6b6b', '#ffd93d'] },
  { id: 'cool', label: 'Cool', colors: ['#667eea', '#764ba2'] },
  { id: 'forest', label: 'Forest', colors: ['#134e5e', '#71b280'] },
  { id: 'ocean', label: 'Ocean', colors: ['#0575e6', '#021b79'] },
  { id: 'sunset', label: 'Sunset', colors: ['#f7971e', '#ffd200'] },
  { id: 'mono', label: 'Mono', colors: ['#2c3e50', '#bdc3c7'] },
];

export function TopToolbar() {
  const name = useStore($iconName);
  const modified = useStore($iconModified);
  const mode = useStore($appearanceMode);
  const lightAngle = useStore($lightAngle);
  const zoom = useStore($zoom);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [editingAngle, setEditingAngle] = useState(false);
  const [angleInput, setAngleInput] = useState(String(lightAngle));

  const handleAngleSubmit = () => {
    const v = parseInt(angleInput, 10);
    if (!isNaN(v)) setLightAngle(Math.min(360, Math.max(-360, v)));
    setEditingAngle(false);
  };

  const handleBgPreset = (preset: typeof BG_PRESETS[0]) => {
    updateBackground({
      type: 'gradient',
      preset: preset.id,
      colors: preset.colors,
      angle: 135,
    } as BackgroundConfig);
    setShowBgPicker(false);
  };

  return (
    <div className="flex items-center h-11 bg-[#1c1c1e] border-b border-[#2c2c2e] px-3 select-none">
      <div className="flex items-center gap-1.5 min-w-[160px]">
        <span className="text-xs font-medium text-[#ebebf5]">{name}</span>
        {modified && <span className="text-xs text-[#636366]">Edited</span>}
      </div>

      <div className="flex-1 flex items-center justify-center gap-3">
        <div className="flex items-center bg-[#2a2a2a] rounded-md overflow-hidden border border-[#3a3a3c]">
          {(['default', 'dark', 'mono'] as AppearanceMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setAppearanceMode(m)}
              className={`px-3 py-1 text-xs capitalize transition-colors
                ${mode === m ? 'bg-[#0a84ff] text-white' : 'text-[#636366] hover:text-[#ebebf5]'}`}
            >
              {m === 'default' ? 'Light' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowBgPicker(!showBgPicker)}
            className="flex items-center gap-1.5 px-2 py-1 bg-[#2a2a2a] border border-[#3a3a3c] rounded-md hover:border-[#636366] transition-colors"
            title="Background"
          >
            <svg className="w-3.5 h-3.5 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            </svg>
            <svg className="w-2.5 h-2.5 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showBgPicker && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-[#2a2a2a] border border-[#3a3a3c] rounded-lg p-2 shadow-xl">
              <div className="grid grid-cols-3 gap-1.5">
                {BG_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleBgPreset(preset)}
                    className="flex flex-col items-center gap-1 p-1.5 rounded hover:bg-[#3a3a3c] transition-colors"
                    title={preset.label}
                  >
                    <div
                      className="w-10 h-10 rounded-lg"
                      style={{ background: `linear-gradient(135deg, ${preset.colors[0]}, ${preset.colors[1]})` }}
                    />
                    <span className="text-2xs text-[#636366]">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
          {editingAngle ? (
            <input
              autoFocus
              type="number"
              value={angleInput}
              onChange={(e) => setAngleInput(e.target.value)}
              onBlur={handleAngleSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleAngleSubmit()}
              className="w-14 text-xs text-center bg-[#2a2a2a] border border-[#0a84ff] rounded px-1 py-0.5 text-[#ebebf5] focus:outline-none"
            />
          ) : (
            <button
              onClick={() => { setEditingAngle(true); setAngleInput(String(lightAngle)); }}
              className="text-xs text-[#ebebf5] hover:text-white"
            >
              {lightAngle}°
            </button>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowZoomMenu(!showZoomMenu)}
            className="flex items-center gap-1 text-xs text-[#ebebf5] hover:text-white"
          >
            {zoom}%
            <svg className="w-2.5 h-2.5 text-[#636366]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showZoomMenu && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-[#2a2a2a] border border-[#3a3a3c] rounded-lg py-1 shadow-xl min-w-[80px]">
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  onClick={() => { setZoom(z); setShowZoomMenu(false); }}
                  className={`w-full text-left px-3 py-1 text-xs hover:bg-[#3a3a3c] transition-colors
                    ${zoom === z ? 'text-[#0a84ff]' : 'text-[#ebebf5]'}`}
                >
                  {z}%
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-[160px] justify-end">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('icon-export'))}
          className="px-3 py-1 text-xs bg-[#0a84ff] text-white rounded-md hover:bg-[#0070e0] transition-colors"
        >
          Export
        </button>
      </div>

      {(showBgPicker || showZoomMenu) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => { setShowBgPicker(false); setShowZoomMenu(false); }}
        />
      )}
    </div>
  );
}
