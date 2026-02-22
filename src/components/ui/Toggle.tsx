import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Toggle({ checked, onChange, label, disabled, size = 'sm' }: ToggleProps) {
  // track: sm=28×16, md=36×20 — thumb: sm=12×12, md=16×16
  // left off=2px, left on = trackW - thumbW - 2
  const trackW  = size === 'sm' ? 28 : 36;
  const trackH  = size === 'sm' ? 16 : 20;
  const thumbSz = size === 'sm' ? 12 : 16;
  const leftOff = 2;
  const leftOn  = trackW - thumbSz - 2;

  return (
    <label
      className={`flex items-center gap-2 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative rounded-full transition-colors duration-200 ${checked ? 'bg-[#0a84ff]' : 'bg-[#3a3a3c]'}`}
        style={{ width: trackW, height: trackH, flexShrink: 0 }}
      >
        <span
          className="absolute rounded-full bg-white transition-all duration-200"
          style={{
            width: thumbSz,
            height: thumbSz,
            top: (trackH - thumbSz) / 2,
            left: checked ? leftOn : leftOff,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        />
      </div>
      {label && <span className="text-xs text-[#ebebf5]">{label}</span>}
    </label>
  );
}
