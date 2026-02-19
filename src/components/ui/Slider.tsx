import React, { useCallback } from 'react';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
  disabled?: boolean;
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  unit = '%',
  disabled,
}: SliderProps) {
  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)),
    [onChange]
  );

  const handleNumberInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Math.min(max, Math.max(min, Number(e.target.value)));
      onChange(v);
    },
    [onChange, min, max]
  );

  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
      {label && <span className="text-xs text-[#636366] w-16 shrink-0">{label}</span>}
      <div className="flex-1 relative h-4 flex items-center">
        <div className="w-full h-1 rounded-full bg-[#3a3a3c]">
          <div
            className="h-1 rounded-full bg-[#0a84ff]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={handleInput}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleNumberInput}
        className="w-10 text-xs text-right bg-[#2a2a2a] border border-[#3a3a3c] rounded px-1 py-0.5 text-[#ebebf5] focus:outline-none focus:border-[#0a84ff]"
      />
      {unit && <span className="text-xs text-[#636366] w-3">{unit}</span>}
    </div>
  );
}
