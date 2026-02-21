import React from 'react';
import { useStore } from '@nanostores/react';
import { $appearanceMode, setAppearanceMode } from '../../store/uiStore';
import type { AppearanceMode } from '../../types/index';

type LightDark = 'light' | 'dark';
type Variant   = 'default' | 'clear' | 'tinted';

function toMode(ld: LightDark, v: Variant): AppearanceMode {
  if (v === 'default') return ld === 'light' ? 'default' : 'dark';
  return `${v}-${ld}` as AppearanceMode;
}

function fromMode(mode: AppearanceMode): { ld: LightDark; variant: Variant } {
  switch (mode) {
    case 'default':      return { ld: 'light', variant: 'default' };
    case 'dark':         return { ld: 'dark',  variant: 'default' };
    case 'clear-light':  return { ld: 'light', variant: 'clear'   };
    case 'clear-dark':   return { ld: 'dark',  variant: 'clear'   };
    case 'tinted-light': return { ld: 'light', variant: 'tinted'  };
    case 'tinted-dark':  return { ld: 'dark',  variant: 'tinted'  };
  }
}

// ─── Glass segmented control ───────────────────────────────────────────────

interface SegOption<T extends string> {
  value: T;
  label: string;
}

function GlassSeg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-[10px]"
      style={{
        background: 'rgba(255,255,255,0.055)',
        border: '0.5px solid rgba(255,255,255,0.10)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="relative px-3 py-[5px] text-[11px] font-medium rounded-[8px] transition-all duration-150 tracking-tight"
            style={
              active
                ? {
                    color: '#ffffff',
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.10) 100%)',
                    boxShadow:
                      '0 1px 4px rgba(0,0,0,0.4), 0 0.5px 0 rgba(255,255,255,0.22) inset',
                  }
                : {
                    color: 'rgba(255,255,255,0.32)',
                    background: 'transparent',
                  }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Mode label helper ──────────────────────────────────────────────────────

const MODE_LABEL: Record<AppearanceMode, string> = {
  'default':      'Default Light',
  'dark':         'Default Dark',
  'clear-light':  'Clear Light',
  'clear-dark':   'Clear Dark',
  'tinted-light': 'Tinted Light',
  'tinted-dark':  'Tinted Dark',
};

// ─── Component ─────────────────────────────────────────────────────────────

export function BottomBar() {
  const mode = useStore($appearanceMode);
  const { ld, variant } = fromMode(mode);

  const setLd = (v: LightDark)  => setAppearanceMode(toMode(v, variant));
  const setVar = (v: Variant)   => setAppearanceMode(toMode(ld, v));

  return (
    <div
      className="flex items-center justify-between h-14 px-5"
      style={{
        background: 'rgba(22,22,24,0.78)',
        backdropFilter: 'blur(32px) saturate(200%)',
        WebkitBackdropFilter: 'blur(32px) saturate(200%)',
        borderTop: '0.5px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Left — Light / Dark */}
      <div className="flex items-center gap-2.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: 'rgba(255,255,255,0.25)' }}
        >
          Appearance
        </span>
        <GlassSeg<LightDark>
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark',  label: 'Dark'  },
          ]}
          value={ld}
          onChange={setLd}
        />
      </div>

      {/* Center — current mode name */}
      <span
        className="text-[11px] font-medium tracking-tight select-none tabular-nums"
        style={{ color: 'rgba(255,255,255,0.20)' }}
      >
        {MODE_LABEL[mode]}
      </span>

      {/* Right — Default / Clear / Tinted */}
      <div className="flex items-center gap-2.5">
        <GlassSeg<Variant>
          options={[
            { value: 'default', label: 'Default' },
            { value: 'clear',   label: 'Clear'   },
            { value: 'tinted',  label: 'Tinted'  },
          ]}
          value={variant}
          onChange={setVar}
        />
        <span
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: 'rgba(255,255,255,0.25)' }}
        >
          Style
        </span>
      </div>
    </div>
  );
}
