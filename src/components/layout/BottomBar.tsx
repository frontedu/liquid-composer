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
    <div className="appearance-segments" role="group" aria-label="Icon appearance">
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={active}
              onClick={() => setAppearanceMode(m.value)}
            >
              {m.label}
            </button>
          );
        })}
    </div>
  );
}
