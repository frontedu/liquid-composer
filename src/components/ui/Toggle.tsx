import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Toggle({ checked, onChange, label, disabled, size = 'sm' }: ToggleProps) {
  const trackW = size === 'sm' ? 'w-7' : 'w-9';
  const trackH = size === 'sm' ? 'h-4' : 'h-5';
  const thumbSz = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const translate = size === 'sm' ? 'translate-x-3' : 'translate-x-4';

  return (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex items-center rounded-full transition-colors duration-200 ${trackW} ${trackH}
          ${checked ? 'bg-[#0a84ff]' : 'bg-[#3a3a3c]'}`}
      >
        <span
          className={`inline-block ${thumbSz} rounded-full bg-white shadow-sm transform transition-transform duration-200
            ${checked ? translate : 'translate-x-0.5'}`}
        />
      </div>
      {label && (
        <span className="text-xs text-[#ebebf5]">{label}</span>
      )}
    </label>
  );
}
