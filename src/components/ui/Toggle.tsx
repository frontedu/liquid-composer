interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export function Toggle({ checked, onChange, label, disabled, size = 'sm', ariaLabel }: ToggleProps) {
  const trackW  = size === 'sm' ? 28 : 42;
  const trackH  = size === 'sm' ? 16 : 24;
  const thumbSz = size === 'sm' ? 12 : 20;
  const leftOff = 2;
  const leftOn  = trackW - thumbSz - 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`glass-toggle flex items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0a84ff] ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        aria-hidden="true"
        className={`relative rounded-full transition-colors duration-200 ${checked ? 'bg-[#0a84ff]' : 'bg-white/[0.14]'}`}
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
      </span>
      {label && <span className="text-xs text-[#ebebf5]">{label}</span>}
    </button>
  );
}
