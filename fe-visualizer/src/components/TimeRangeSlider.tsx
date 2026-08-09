import {RangeSlider} from './RangeSlider';
import {minutesToTime} from '../truckTime';

export type TimeRangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  from: number;
  until: number;
  onChange: (from: number, until: number) => void;
};

export function TimeRangeSlider({min, max, step = 15, from, until, onChange}: TimeRangeSliderProps) {
  return (
    <RangeSlider
      classPrefix="time-range"
      label="Time"
      formatValue={minutesToTime}
      ariaLabelFrom="Earliest time"
      ariaLabelUntil="Latest time"
      min={min}
      max={max}
      step={step}
      from={from}
      until={until}
      onChange={onChange}
    />
  );
}
