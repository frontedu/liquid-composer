import React from 'react';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  className?: string;
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  label,
  className = '',
}: NumberInputProps) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {label && <span className="text-xs text-[#636366]">{label}</span>}
      <div className="flex items-center bg-[#2a2a2a] border border-[#3a3a3c] rounded overflow-hidden">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            let v = Number(e.target.value);
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            onChange(v);
          }}
          className="w-12 text-xs text-center bg-transparent text-[#ebebf5] focus:outline-none px-1 py-0.5"
        />
        {unit && (
          <span className="text-xs text-[#636366] pr-1.5">{unit}</span>
        )}
      </div>
    </div>
  );
}
