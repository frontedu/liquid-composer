import React, { useCallback, useRef } from 'react';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  className?: string;
  /** Units changed per pixel of horizontal drag. Default: 1 */
  dragSensitivity?: number;
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
  dragSensitivity = 1,
}: NumberInputProps) {
  const startRef = useRef<{ x: number; val: number } | null>(null);

  const clamp = useCallback(
    (v: number) => {
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      return Math.round(v / step) * step;
    },
    [min, max, step],
  );

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startRef.current = { x: e.clientX, val: value };

      const onMove = (ev: MouseEvent) => {
        if (!startRef.current) return;
        const dx = ev.clientX - startRef.current.x;
        onChange(clamp(startRef.current.val + dx * dragSensitivity));
      };
      const onUp = () => {
        startRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [value, dragSensitivity, clamp, onChange],
  );

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {label && (
        <span
          className="text-xs text-[#636366] cursor-ew-resize select-none"
          onMouseDown={handleDragStart}
          title="Drag to change"
        >
          {label}
        </span>
      )}
      <div className="flex items-center bg-[#2a2a2a] border border-[#3a3a3c] rounded-md overflow-hidden">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="w-12 text-xs text-center bg-transparent text-[#ebebf5] focus:outline-none px-1 py-0.5"
        />
        {unit && (
          <span
            className="text-xs text-[#636366] pr-1.5 cursor-ew-resize select-none"
            onMouseDown={handleDragStart}
            title="Drag to change"
          >
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
