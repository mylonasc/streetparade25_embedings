import {parseTimeRange} from '../loveMobile';
import {likedSlotRange, minutesToTime, rangeInMinutes, timePosition, truckRangeFromTime} from '../truckTime';
import type {ClockRange, MinuteRange} from '../truckTime';

export type TruckTimeWidgetProps = {
  eventRange: ClockRange | null;
  truckTime?: string | null;
  likedSlots?: Array<{set_start?: string | null; set_end?: string | null}>;
};

export function TruckTimeWidget({eventRange, truckTime, likedSlots = []}: TruckTimeWidgetProps) {
  const event = eventRange ? rangeInMinutes(eventRange) : null;
  const truck = truckRangeFromTime(truckTime);
  const liked = likedSlotRange(likedSlots);
  if (!event) return null;
  const truckPos = truck ? timePosition(event, truck) : null;
  const likedPos = liked ? timePosition(event, liked) : null;
  return (
    <span
      className="truck-time-widget"
      role="img"
      aria-label={widgetLabel(event, truck, liked)}
    >
      <span className="truck-time-track" aria-hidden="true" />
      {truckPos && <span className="truck-time-window" aria-hidden="true" style={{left: `${truckPos.left}%`, width: `${truckPos.width}%`}} />}
      {likedPos && <span className="truck-time-liked" aria-hidden="true" style={{left: `${likedPos.left}%`, width: `${likedPos.width}%`}} />}
    </span>
  );
}

function widgetLabel(event: MinuteRange, truck: MinuteRange | null, liked: MinuteRange | null): string {
  const parts = [`Whole event ${minutesToTime(event.start)}–${minutesToTime(event.end)}`];
  if (truck) parts.push(`truck plays ${minutesToTime(truck.start)}–${minutesToTime(truck.end)}`);
  if (liked) parts.push(`liked acts play ${minutesToTime(liked.start)}–${minutesToTime(liked.end)}`);
  return parts.join('; ');
}

export type TimeRangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  from: number;
  until: number;
  onChange: (from: number, until: number) => void;
};

export function TimeRangeSlider({min, max, step = 15, from, until, onChange}: TimeRangeSliderProps) {
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  const fromValue = clamp(from, min, max);
  const untilValue = clamp(until, min, max);
  const span = Math.max(1, max - min);
  const leftPct = ((fromValue - min) / span) * 100;
  const widthPct = ((untilValue - fromValue) / span) * 100;
  return (
    <div className="time-range-filter">
      <span className="time-range-labels">
        Time <b>{minutesToTime(fromValue)}</b> – <b>{minutesToTime(untilValue)}</b>
      </span>
      <div className="time-range-track-wrap">
        <span className="time-range-track" aria-hidden="true" />
        <span className="time-range-track-fill" aria-hidden="true" style={{left: `${leftPct}%`, width: `${widthPct}%`}} />
        <input
          type="range"
          className="time-range-input time-range-from"
          min={min}
          max={max}
          step={step}
          value={fromValue}
          aria-label="Earliest time"
          onChange={(event) => onChange(clamp(Number(event.target.value), min, untilValue), untilValue)}
        />
        <input
          type="range"
          className="time-range-input time-range-until"
          min={min}
          max={max}
          step={step}
          value={untilValue}
          aria-label="Latest time"
          onChange={(event) => onChange(fromValue, clamp(Number(event.target.value), fromValue, max))}
        />
      </div>
    </div>
  );
}

export function slotLabel(slot: {name?: string; set_start?: string | null; set_end?: string | null}): string {
  const range = parseTimeRange(`${slot.set_start ?? ''} - ${slot.set_end ?? ''}`);
  if (!range) return slot.name || '';
  return `${slot.name || ''} ${range.start}–${range.end}`;
}
