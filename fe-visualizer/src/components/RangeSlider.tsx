import type {ReactNode} from 'react';

export type RangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  from: number;
  until: number;
  onChange: (from: number, until: number) => void;
  label?: ReactNode;
  formatValue?: (value: number) => string;
  valueSeparator?: string;
  ariaLabelFrom?: string;
  ariaLabelUntil?: string;
  classPrefix?: string;
  disabled?: boolean;
};

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function RangeSlider({
  min,
  max,
  step = 1,
  from,
  until,
  onChange,
  label,
  formatValue = String,
  valueSeparator = '–',
  ariaLabelFrom = 'Earliest',
  ariaLabelUntil = 'Latest',
  classPrefix = 'range-slider',
  disabled = false,
}: RangeSliderProps) {
  const fromValue = clamp(from, min, max);
  const untilValue = clamp(until, min, max);
  const span = Math.max(1, max - min);
  const fromPct = ((fromValue - min) / span) * 100;
  const untilPct = ((untilValue - min) / span) * 100;
  return (
    <label className={`${classPrefix}-filter`}>
      <span className={`${classPrefix}-labels`}>
        {label && <>{label} </>}
        <b>{formatValue(fromValue)}</b> {valueSeparator} <b>{formatValue(untilValue)}</b>
      </span>
      <div className={`${classPrefix}-track-wrap`}>
        <span className={`${classPrefix}-track`} aria-hidden="true" />
        <span className={`${classPrefix}-track-fill`} aria-hidden="true" style={{left: `${fromPct}%`, width: `${Math.max(0, untilPct - fromPct)}%`}} />
        <input
          type="range"
          className={`${classPrefix}-input ${classPrefix}-from`}
          min={min}
          max={max}
          step={step}
          value={fromValue}
          aria-label={ariaLabelFrom}
          disabled={disabled}
          onChange={(event) => onChange(clamp(Number(event.target.value), min, untilValue), untilValue)}
        />
        <input
          type="range"
          className={`${classPrefix}-input ${classPrefix}-until`}
          min={min}
          max={max}
          step={step}
          value={untilValue}
          aria-label={ariaLabelUntil}
          disabled={disabled}
          onChange={(event) => onChange(fromValue, clamp(Number(event.target.value), fromValue, max))}
        />
      </div>
    </label>
  );
}
