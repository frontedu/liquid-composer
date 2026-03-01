import React from 'react';
import { useStore } from '@nanostores/react';
import { $appearanceMode, setAppearanceMode } from '../../store/uiStore';
import type { AppearanceMode } from '../../types/index';

const MODES: { value: AppearanceMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'dark',    label: 'Dark'    },
  { value: 'clear',   label: 'Clear'   },
];

export function BottomBar() {
  const mode = useStore($appearanceMode);

  return (
    <div className="absolute bottom-5 left-4 pointer-events-none z-20">
      <div
        className="flex items-center gap-0.5 p-0.5 rounded-[10px] pointer-events-auto"
        style={{
          background: 'rgba(255,255,255,0.055)',
          border: '0.5px solid rgba(255,255,255,0.10)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }}
      >
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              onClick={() => setAppearanceMode(m.value)}
              className="relative px-4 py-[5px] text-[11px] font-medium rounded-[8px] transition-all duration-150 tracking-tight"
              style={
                active
                  ? {
                      color: '#ffffff',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.10) 100%)',
                    }
                  : {
                      color: 'rgba(255,255,255,0.32)',
                      background: 'transparent',
                    }
              }
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
