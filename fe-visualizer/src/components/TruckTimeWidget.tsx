import {useState} from 'react';
import {parseTimeRange} from '../loveMobile';
import {likedSlotRange, minutesToTime, rangeInMinutes, timePosition, truckRangeFromTime} from '../truckTime';
import type {ClockRange, MinuteRange} from '../truckTime';

export type TruckTimeWidgetProps = {
  timelineRange: ClockRange | null;
  truckTime?: string | null;
  likedSlots?: Array<{name?: string; set_start?: string | null; set_end?: string | null}>;
  compact?: boolean;
};

export function TruckTimeWidget({timelineRange, truckTime, likedSlots = [], compact = false}: TruckTimeWidgetProps) {
  const [hovered, setHovered] = useState(false);
  const event = timelineRange ? rangeInMinutes(timelineRange) : null;
  const truck = truckRangeFromTime(truckTime);
  const liked = likedSlotRange(likedSlots);
  const truckPos = event && truck ? timePosition(event, truck) : null;
  const likedPos = event && liked ? timePosition(event, liked) : null;
  const showTooltip = !compact && hovered && likedSlots.length > 0;
  return (
    <div
      className={`truck-time-widget${compact ? ' compact' : ''}`}
      role="img"
      aria-label={widgetLabel(event, truck, liked)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="truck-time-track" aria-hidden="true" />
      {truckPos && <span className="truck-time-window" aria-hidden="true" style={{left: `${truckPos.left}%`, width: `${truckPos.width}%`}} />}
      {likedPos && <span className="truck-time-liked" aria-hidden="true" style={{left: `${likedPos.left}%`, width: `${likedPos.width}%`}} />}
      {showTooltip && (
        <span className="truck-time-tooltip" role="tooltip">
          {likedSlots.map((slot, index) => (
            <span className="truck-time-tooltip-slot" key={`${slot.name ?? index}-${index}`}>{slotLabel(slot)}</span>
          ))}
        </span>
      )}
    </div>
  );
}

function widgetLabel(event: MinuteRange | null, truck: MinuteRange | null, liked: MinuteRange | null): string {
  if (!event) return 'Truck timeline';
  const parts = [`Timeline ${minutesToTime(event.start)}–${minutesToTime(event.end)}`];
  if (truck) parts.push(`truck plays ${minutesToTime(truck.start)}–${minutesToTime(truck.end)}`);
  if (liked) parts.push(`liked acts play ${minutesToTime(liked.start)}–${minutesToTime(liked.end)}`);
  return parts.join('; ');
}

export function slotLabel(slot: {name?: string; set_start?: string | null; set_end?: string | null}): string {
  const range = parseTimeRange(`${slot.set_start ?? ''} - ${slot.set_end ?? ''}`);
  if (!range) return slot.name || '';
  return `${slot.name || ''} ${range.start}–${range.end}`;
}
