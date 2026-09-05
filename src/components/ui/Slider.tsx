import React, { useCallback, useState, useEffect, useRef, useId } from 'react';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
  disabled?: boolean;
  layout?: 'inline' | 'stacked';
  ariaLabel?: string;
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
  layout = 'inline',
  ariaLabel,
}: SliderProps) {
  const id = useId();
  const safeValue = isNaN(value) ? min : value;
  const [inputVal, setInputVal] = useState(String(safeValue));
  const rafRef = useRef<number>(0);
  const pendingVal = useRef<number>(safeValue);

  useEffect(() => {
    setInputVal(String(safeValue));
  }, [safeValue]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const commit = useCallback(
    (raw: string) => {
      const parsed = Number(raw);
      if (raw === '' || isNaN(parsed)) {
        setInputVal(String(safeValue));
        return;
      }
      const clamped = Math.min(max, Math.max(min, Number((Math.round(parsed / step) * step).toPrecision(12))));
      onChange(clamped);
      setInputVal(String(clamped));
    },
    [safeValue, onChange, min, max, step],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = Number(e.target.value);
      pendingVal.current = newVal;
      setInputVal(String(newVal)); // instant UI feedback
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          onChange(pendingVal.current);
        });
      }
    },
    [onChange],
  );

  const pct = ((safeValue - min) / (max - min)) * 100;

  return (
    <div className={`${layout === 'stacked' ? 'glass-slider' : 'flex items-center gap-2'} ${disabled ? 'opacity-40' : ''}`}>
      {label && <label htmlFor={id} className="text-xs text-[#636366] w-16 shrink-0">{label}</label>}
      <div className="glass-slider-track flex-1 relative h-4 flex items-center">
        <div className="w-full h-1 rounded-full bg-white/[0.12]">
          <div className="h-1 rounded-full bg-[#0a84ff]" style={{ width: `${pct}%` }} />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[13px] h-[13px] rounded-full bg-white pointer-events-none"
          style={{
            left: `calc(${pct}% - ${(pct / 100) * (layout === 'stacked' ? 18 : 13)}px)`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(0,0,0,0.12)',
          }}
        />
        <input
          id={id}
          type="range"
          aria-label={ariaLabel ?? label}
          aria-valuetext={`${safeValue}${unit}`}
          min={min}
          max={max}
          step={step}
          value={safeValue}
          disabled={disabled}
          onChange={handleInput}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </div>
      <div className={layout === 'stacked' ? 'glass-slider-value' : 'flex items-center gap-2'}>
        <input
          type="number"
          aria-label={`${ariaLabel ?? label ?? 'Slider'} value`}
          min={min}
          max={max}
          step={step}
          value={inputVal}
          disabled={disabled}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setInputVal(String(safeValue));
          }}
          className="w-10 text-xs text-right bg-white/[0.06] border border-white/[0.08] rounded px-1 py-0.5 text-[#ebebf5] focus:outline-hidden focus:border-[#0a84ff]"
        />
        {unit && <span className="text-xs text-[#636366] w-3">{unit}</span>}
      </div>
    </div>
  );
}
