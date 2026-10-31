import React, { useEffect, useRef } from 'react';
import { setHistoryGesture } from '../../store/iconStore';
import { NumberInput } from '../ui/NumberInput';

export type RefractionChange = { strength?: number; height?: number };

const INSET = 8; // px kept around the dot travel
const HEIGHT_TICKS = Array.from({ length: 11 }, (_, i) => i * 10);
const STRENGTH_TICKS = Array.from({ length: 21 }, (_, i) => i * 10 - 100);
const KEY_STEPS: Record<string, ['strength' | 'height', number]> = { ArrowLeft: ['strength', -1], ArrowRight: ['strength', 1], ArrowUp: ['height', 1], ArrowDown: ['height', -1] };
const RESET = { strength: 0, height: 50 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const along = (f: number) => `calc(${INSET}px + (100% - ${2 * INSET}px) * ${f})`;

export function RefractionPad({ strength, height, dimmed, onChange }: {
  strength: number;
  height: number;
  dimmed: boolean;
  onChange: (change: RefractionChange) => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const cleanClicksRef = useRef(0);
  const downRef = useRef<[number, number]>([0, 0]);
  const rafRef = useRef(0);
  const pendingRef = useRef<RefractionChange>({});

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    if (draggingRef.current) setHistoryGesture(false);
  }, []);

  const track = (e: React.PointerEvent) => {
    if (Math.hypot(e.clientX - downRef.current[0], e.clientY - downRef.current[1]) > 3) movedRef.current = true;
    const r = padRef.current!.getBoundingClientRect();
    const fx = clamp((e.clientX - r.left - INSET) / (r.width - 2 * INSET), 0, 1);
    const fy = clamp((e.clientY - r.top - INSET) / (r.height - 2 * INSET), 0, 1);
    pendingRef.current = { strength: Math.round(fx * 200 - 100), height: Math.round((1 - fy) * 100) };
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      onChange(pendingRef.current);
      if (draggingRef.current) setHistoryGesture(true);
    });
  };

  const release = () => {
    draggingRef.current = false;
    setHistoryGesture(false);
  };

  const reset = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    onChange(RESET);
  };

  return (
    <div className="space-y-2 pt-1">
      <div
        ref={padRef}
        role="group"
        aria-roledescription="2D slider"
        tabIndex={0}
        aria-label={`Refraction strength ${strength} %, height ${height} %`}
        title="Drag to set strength and height. Double-click or Home resets."
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          movedRef.current = false;
          downRef.current = [e.clientX, e.clientY];
          track(e);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          if (e.buttons & 1) track(e);
          else release();
        }}
        onPointerUp={() => {
          cleanClicksRef.current = movedRef.current ? 0 : cleanClicksRef.current + 1;
          release();
        }}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onDoubleClick={() => { if (cleanClicksRef.current >= 2) reset(); }}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          if (e.key === 'Home') {
            e.preventDefault();
            reset();
            return;
          }
          const step = KEY_STEPS[e.key];
          if (!step) return;
          e.preventDefault();
          const [axis, dir] = step;
          const d = (e.shiftKey ? 10 : 1) * dir;
          onChange(axis === 'strength' ? { strength: clamp(strength + d, -100, 100) } : { height: clamp(height + d, 0, 100) });
        }}
        className={`relative h-28 rounded-[10px] bg-white/[0.05] border border-white/[0.08] cursor-crosshair touch-none select-none ${dimmed ? 'opacity-50' : ''}`}
      >
        {HEIGHT_TICKS.map((h) => (
          <span
            key={`h${h}`}
            aria-hidden="true"
            className={`absolute left-1/2 h-px -translate-x-1/2 -translate-y-1/2 ${h === RESET.height ? 'w-3 bg-white/45' : 'w-1.5 bg-white/20'}`}
            style={{ top: along(1 - h / 100) }}
          />
        ))}
        {STRENGTH_TICKS.map((s) => (
          <span
            key={`s${s}`}
            aria-hidden="true"
            className={`absolute bottom-0 w-px -translate-x-1/2 ${s === RESET.strength ? 'h-2 bg-white/45' : s % 50 === 0 ? 'h-1.5 bg-white/30' : 'h-1 bg-white/20'}`}
            style={{ left: along((s + 100) / 200) }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0a84ff] border-2 border-white/90 shadow-[0_1px_4px_rgba(0,0,0,0.5)] pointer-events-none"
          style={{ left: along((strength + 100) / 200), top: along(1 - height / 100) }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <span className="text-2xs text-[#a1a1aa]">Strength</span>
        <span className="text-2xs text-[#a1a1aa]">Height</span>
        <NumberInput ariaLabel="Refraction strength" className="min-w-0" value={strength} onChange={(v) => onChange({ strength: v })} min={-100} max={100} unit="%" />
        <NumberInput ariaLabel="Refraction height" className="min-w-0" value={height} onChange={(v) => onChange({ height: v })} min={0} max={100} unit="%" />
      </div>
    </div>
  );
}
